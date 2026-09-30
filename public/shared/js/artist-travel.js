// ============================================
// Travel del artista (DS Bauhaus) — refs Figma 68:11882 · 419:2487 · 131:14426
// · 132:14729 · 173:24897 · 173:25982 · 173:26741 · 173:27503 · 173:28256.
// Dashboard de giras + modal crear + éxito + detalle (?trip=<id>) + modales
// de acción. Datos SOLO vía WeotziData.Travel / WeotziData.Studios; Storage
// directo al bucket privado artist-trip-docs.
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;
    const D = window.WeotziData;

    const RETURN_TO = '/artist/login?returnTo=%2Fartist%2Ftravel';
    const BUCKET = 'artist-trip-docs';
    const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
    const ALLOWED_DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

    const TYPE_LABELS = { guest_spot: 'Guest Spot', convencion: 'Convención', estudio_invitado: 'Estudio invitado' };
    const STATUS_LABELS = { planificado: 'Planificado', pendiente: 'Pendiente', confirmado: 'Confirmado', finalizado: 'Finalizado', cancelado: 'Cancelado' };
    const TL_STATUS_LABELS = { planificado: 'Planificado', pendiente: 'Pendiente de confirmación', confirmado: 'Confirmado', finalizado: 'Finalizado', cancelado: 'Cancelado' };
    const STATUS_TAG_CLASS = {
        planificado: 'wo-tag',
        pendiente: 'wo-tag wo-tag--highlight',
        confirmado: 'wo-tag wo-tag--info',
        finalizado: 'wo-tag wo-tag--archived',
        cancelado: 'wo-tag wo-tag--urgent',
    };
    const DOC_ICONS = { pasaje: 'file-text', reserva_hotel: 'home', contrato: 'file', otro: 'paperclip' };
    const DOC_LABELS = { pasaje: 'Pasaje', reserva_hotel: 'Reserva de hotel', contrato: 'Contrato', otro: 'Otro' };
    const MONTHS_AB = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const REGION_LABELS = { sudamerica: 'Sudamérica', europa: 'Europa', norteamerica: 'Norteamérica', otro: 'Otras regiones' };
    const FIGMA_DEMO_MARKER = '[PRUEBA][TRAVEL-FIGMA-20260830]';

    const REGION_BY_COUNTRY = {
        argentina: 'sudamerica', brasil: 'sudamerica', brazil: 'sudamerica', chile: 'sudamerica',
        uruguay: 'sudamerica', paraguay: 'sudamerica', bolivia: 'sudamerica', peru: 'sudamerica',
        ecuador: 'sudamerica', colombia: 'sudamerica', venezuela: 'sudamerica',
        mexico: 'norteamerica', 'estados unidos': 'norteamerica', eeuu: 'norteamerica',
        usa: 'norteamerica', canada: 'norteamerica',
        espana: 'europa', portugal: 'europa', francia: 'europa', italia: 'europa',
        alemania: 'europa', 'reino unido': 'europa', inglaterra: 'europa', irlanda: 'europa',
        'paises bajos': 'europa', holanda: 'europa', belgica: 'europa', suiza: 'europa',
        austria: 'europa', polonia: 'europa', suecia: 'europa', noruega: 'europa',
        dinamarca: 'europa', finlandia: 'europa', grecia: 'europa', 'republica checa': 'europa',
        chequia: 'europa', hungria: 'europa', rumania: 'europa', croacia: 'europa',
    };

    // Catálogo explícito para destinos habituales del prototipo. Las sedes
    // geocodificadas de Supabase siempre tienen prioridad sobre este fallback.
    const TRAVEL_CITY_COORDINATES = [
        { city: 'Buenos Aires', country: 'Argentina', latitude: -34.6037, longitude: -58.3816 },
        { city: 'Barcelona', country: 'España', latitude: 41.3874, longitude: 2.1686 },
        { city: 'Berlín', country: 'Alemania', latitude: 52.52, longitude: 13.405 },
        { city: 'Berlin', country: 'Alemania', latitude: 52.52, longitude: 13.405 },
        { city: 'Ciudad de México', country: 'México', latitude: 19.4326, longitude: -99.1332 },
        { city: 'Mexico City', country: 'México', latitude: 19.4326, longitude: -99.1332 },
        { city: 'Madrid', country: 'España', latitude: 40.4168, longitude: -3.7038 },
        { city: 'Santiago', country: 'Chile', latitude: -33.4489, longitude: -70.6693 },
        { city: 'Montevideo', country: 'Uruguay', latitude: -34.9011, longitude: -56.1645 },
        { city: 'Lima', country: 'Perú', latitude: -12.0464, longitude: -77.0428 },
        { city: 'Lisboa', country: 'Portugal', latitude: 38.7223, longitude: -9.1393 },
    ];

    // ---------- Estado ----------
    let session = null;
    let artist = null;
    let trips = [];
    let passportStamps = null;
    let currentTrip = null;      // detalle (embed completo)
    let linkedStudioInfo = null; // fila de studios del link principal (dirección)
    let lastCreated = null;
    const filters = { region: 'global', year: 'all', status: 'all', type: 'all', origin: 'all' };
    let sortAsc = true;
    let selectedStudio = null;   // modal vincular
    let linkDirectoryRows = [];
    let searchTimer = null;
    let activeModal = null;
    let lastFocusedElement = null;
    let pendingShareSlug = null;
    let pendingShareTripId = null;
    let travelStudioCoordinates = [];
    let travelCityCoordinates = TRAVEL_CITY_COORDINATES.map((row) => ({ ...row }));
    let selectedGlobeTripId = null;
    let destinationNavigator = null;
    let selectedHeroTripId = null;
    const createFormState = window.TravelFormModel?.createTravelFormState?.() || null;
    let createCityPicker = null;
    let createCountryPicker = null;
    let createVenuePicker = null;
    let createStudioSearchTimer = null;
    let createStudioSearchToken = 0;
    let createStudioRows = [];

    const FOCUSABLE_SELECTOR = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    // ---------- Utilidades ----------
    const $ = (id) => document.getElementById(id);

    function refreshIcons(root = document) {
        window.WoIcons?.hydrate(root);
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function pd(dateStr) {
        const [y, m, d] = String(dateStr).split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    function today() {
        const n = new Date();
        return new Date(n.getFullYear(), n.getMonth(), n.getDate());
    }
    const DAY_MS = 24 * 60 * 60 * 1000;
    const daysDiff = (a, b) => Math.round((b - a) / DAY_MS);

    function fmtShort(dateStr) {
        const d = pd(dateStr);
        return `${d.getDate()} ${MONTHS_AB[d.getMonth()]}`;
    }
    function fmtShortHero(dateStr) {
        const d = pd(dateStr);
        return `${d.getDate()} ${MONTHS_AB[d.getMonth()].toUpperCase()}`;
    }
    function fmtLong(dateStr) {
        const d = pd(dateStr);
        return `${d.getDate()} ${MONTHS_AB[d.getMonth()]} ${d.getFullYear()}`;
    }
    const fmtRange = (t) => `${fmtShort(t.start_date)} – ${fmtShort(t.end_date)}`;
    const fmtRangeLong = (t) => `${fmtLong(t.start_date)} – ${fmtLong(t.end_date)}`;

    function normalize(s) {
        return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    }
    function deriveRegion(country) {
        return REGION_BY_COUNTRY[normalize(country)] || 'otro';
    }
    function slugify(s) {
        return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'viaje';
    }
    function makeSlug(trip) {
        const d = pd(trip.start_date);
        const prefix = `${slugify(trip.city)}-${MONTHS_AB[d.getMonth()]}${String(d.getFullYear()).slice(2)}`;
        const randomBytes = new Uint8Array(16);
        if (globalThis.crypto?.getRandomValues) {
            globalThis.crypto.getRandomValues(randomBytes);
            const secureToken = [...randomBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
            return `${prefix}-${secureToken}`;
        }
        const uuid = globalThis.crypto?.randomUUID?.();
        if (uuid) return `${prefix}-${uuid.replace(/-/g, '')}`;
        throw new Error('No hay una fuente criptográfica segura para crear el enlace.');
    }

    function isFigmaDemoTrip(trip) {
        return String(trip?.personal_notes || '').includes(FIGMA_DEMO_MARKER);
    }

    function visibleTripNotes(trip) {
        return String(trip?.personal_notes || '').replace(FIGMA_DEMO_MARKER, '').trim();
    }

    // Estado visible: un viaje activo con fecha de regreso pasada se muestra
    // finalizado sin escribir en la base (derivación client-side).
    function dStatus(t) {
        if (t.status === 'cancelado') return 'cancelado';
        if (isFigmaDemoTrip(t)) return t.status;
        if (pd(t.end_date) < today()) return 'finalizado';
        return t.status;
    }
    function isOngoing(t) {
        const n = today();
        return dStatus(t) !== 'cancelado' && pd(t.start_date) <= n && pd(t.end_date) >= n;
    }
    function tripRegion(t) {
        return t.region || deriveRegion(t.country);
    }
    function primaryStudioLink(t) {
        const links = (t.trip_studio_links || [])
            .filter((link) => link.status !== 'cancelada' && link.status !== 'rechazada');
        const hinted = normalize(t.studio_name_hint);
        return (hinted && links.find((link) => normalize(link.studio_name) === hinted))
            || links.find((link) => link.status === 'confirmada')
            || links.find((link) => link.status === 'esperando_confirmacion')
            || null;
    }
    function tripStudioName(t) {
        const best = primaryStudioLink(t);
        return best ? best.studio_name : (t.studio_name_hint || null);
    }

    function travelPath(tripId = null) {
        return window.TravelDashboardModel?.canonicalTravelPath?.(tripId)
            || `/artist/travel/${tripId ? `?trip=${encodeURIComponent(String(tripId))}` : ''}`;
    }

    function destroyTravelGlobe() {
        $('tv-globe')?.pause?.();
    }

    function syncTravelSelectionDom() {
        document.querySelectorAll('#tv-agenda-list [data-trip], #tv-timeline [data-trip]').forEach((node) => {
            const selected = String(node.getAttribute('data-trip')) === String(selectedGlobeTripId || '');
            node.classList.toggle('is-selected', selected);
            if (selected) node.setAttribute('aria-current', 'true');
            else node.removeAttribute('aria-current');
        });
    }

    function selectTravelStop(id, { focus = false } = {}) {
        if (!id) return null;
        const stop = $('tv-globe')?.selectTrip?.(String(id), { focus, emit: false });
        if (!stop) return null;
        selectedGlobeTripId = String(stop.id);
        syncTravelSelectionDom();
        return stop;
    }

    // ---------- Vistas ----------
    function showView(name) {
        if (name !== 'dashboard') destroyTravelGlobe();
        $('tv-view-dashboard').hidden = name !== 'dashboard';
        $('tv-view-success').hidden = name !== 'success';
        $('tv-view-detail').hidden = name !== 'detail';
        document.body.dataset.travelView = name;
        window.scrollTo(0, 0);
    }

    function routeFromUrl() {
        const id = new URLSearchParams(location.search).get('trip');
        if (id) {
            openTrip(id, { push: false });
        } else {
            currentTrip = null;
            renderDashboard();
            showView('dashboard');
        }
    }

    // ---------- Modales ----------
    function openModal(id) {
        const overlay = $(id);
        if (!overlay) return;
        lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        activeModal = overlay;
        overlay.hidden = false;
        document.body.classList.add('tvm-open');
        if (['tv-modal-edit', 'tv-modal-dates', 'tv-modal-link', 'tv-modal-share', 'tv-modal-cancel'].includes(id)) {
            setDetailHeaderStatus('confirmado');
        }
        const dialog = overlay.querySelector('[role="dialog"]');
        requestAnimationFrame(() => {
            const initial = dialog?.querySelector('[data-modal-initial-focus]')
                || dialog?.querySelector(FOCUSABLE_SELECTOR)
                || dialog;
            initial?.focus();
        });
    }
    function closeModal(id, { restoreFocus = true } = {}) {
        const overlay = $(id);
        if (!overlay || overlay.hidden) return;
        overlay.hidden = true;
        if (activeModal === overlay) activeModal = null;
        document.body.classList.remove('tvm-open');
        if (currentTrip) setDetailHeaderStatus(detailStatusForTrip(currentTrip));
        const returnFocus = lastFocusedElement;
        lastFocusedElement = null;
        if (restoreFocus && returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
    }
    function focusViewTarget(id) {
        requestAnimationFrame(() => {
            const target = $(id);
            if (target?.isConnected && !target.closest('[hidden]')) target.focus({ preventScroll: true });
        });
    }
    function detailStatusForTrip(trip) {
        const primary = primaryStudioLink(trip);
        return primary?.status === 'esperando_confirmacion' ? 'pendiente' : dStatus(trip);
    }
    function setDetailHeaderStatus(status) {
        const tag = $('tvd-status-tag');
        if (!tag || !STATUS_LABELS[status]) return;
        tag.className = STATUS_TAG_CLASS[status];
        tag.textContent = STATUS_LABELS[status];
    }
    function wireModals() {
        document.querySelectorAll('[data-close]').forEach((btn) => {
            btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close')));
        });
        document.querySelectorAll('.tvm-overlay').forEach((ov) => {
            ov.addEventListener('mousedown', (e) => {
                if (e.target === ov) closeModal(ov.id);
            });
        });
        document.addEventListener('keydown', (e) => {
            if (!activeModal || activeModal.hidden) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                closeModal(activeModal.id);
                return;
            }
            if (e.key !== 'Tab') return;
            const dialog = activeModal.querySelector('[role="dialog"]');
            const focusables = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
                .filter((element) => element.getClientRects().length > 0);
            if (!focusables.length) {
                e.preventDefault();
                dialog.focus();
                return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        });
    }

    // ============================================
    // ARRANQUE
    // ============================================
    document.addEventListener('DOMContentLoaded', async () => {
        const legacyUrl = new URL(window.location.href);
        const canonicalTravelPathname = legacyUrl.pathname === '/artist/travel' ? '/artist/travel/' : legacyUrl.pathname;
        if (legacyUrl.searchParams.has('globe') || canonicalTravelPathname !== legacyUrl.pathname) {
            legacyUrl.searchParams.delete('globe');
            history.replaceState({}, '', `${canonicalTravelPathname}${legacyUrl.search}${legacyUrl.hash}`);
        }
        setupMobileMenu();
        wireLogout();
        wireModals();
        wireDashboard();
        wireCreate();
        wireSuccess();
        wireDetailStatic();
        wireLinkModal();
        wireShareModal();
        wireDocModal();

        try {
            const { data } = await _supabase.auth.getSession();
            session = data?.session || null;
        } catch (err) {
            console.warn('[travel] no pudimos leer la sesión:', err);
        }
        if (!session) { window.location.href = RETURN_TO; return; }

        try {
            const { data: row } = await D.Artists.getByUserId(
                session.user.id,
                'user_id, name, username, city, country, latitude, longitude'
            );
            artist = row || null;
        } catch (err) { artist = null; }

        await loadTrips();
        routeFromUrl();
        window.addEventListener('popstate', routeFromUrl);
        window.addEventListener('pagehide', destroyTravelGlobe);
        window.addEventListener('pageshow', (event) => {
            if (event.persisted && !new URLSearchParams(location.search).get('trip')) {
                renderDashboard();
            }
        });
        window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => {
            if (document.body.dataset.travelView === 'dashboard') renderGlobe(filteredTrips());
        });
    });

    async function loadTrips() {
        try {
            trips = await D.Travel.listForArtist(session.user.id);
        } catch (err) {
            console.error('[travel] error cargando viajes:', err);
            trips = [];
        }
        if (typeof D.Travel.listPassport === 'function') {
            try {
                passportStamps = await D.Travel.listPassport(session.user.id);
            } catch (err) {
                console.warn('[travel] passport persistido no disponible:', err);
                passportStamps = null;
            }
        } else {
            passportStamps = null;
        }
        await hydrateTravelStudioCoordinates();
        hydrateTravelCityCoordinates().then(() => {
            if (document.body.dataset.travelView === 'dashboard') renderGlobe(filteredTrips());
        }).catch((error) => {
            console.warn('[travel] geocodificación de destinos no disponible:', error);
        });
    }

    function rememberTravelCityCoordinate(address) {
        const latitude = Number(address?.latitude);
        const longitude = Number(address?.longitude);
        const city = String(address?.city || address?.locality || '').trim();
        const country = String(address?.country || '').trim();
        if (!city || !country || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
        if (latitude === 0 && longitude === 0) return false;
        const key = `${normalize(city)}|${normalize(country)}`;
        const existing = travelCityCoordinates.findIndex((row) => `${normalize(row.city)}|${normalize(row.country)}` === key);
        const next = { city, country, latitude, longitude };
        if (existing >= 0) travelCityCoordinates[existing] = next;
        else travelCityCoordinates.push(next);
        return true;
    }

    async function hydrateTravelCityCoordinates() {
        const geocoder = window.WeOtziGeocoder;
        const model = window.TravelDashboardModel;
        if (!geocoder?.geocodeQuery || !model?.buildMissingDestinationQueries) return;
        const apiConfigured = Boolean(window.CONFIG?.googleMaps?.apiKey) || geocoder.hasGoogleApi?.() === true;
        if (!apiConfigured) return;
        const normalizedTrips = trips.map((trip) => ({ ...trip, status: dStatus(trip) }));
        const queries = model.buildMissingDestinationQueries(
            normalizedTrips,
            travelCityCoordinates,
            { today: today() }
        ).slice(0, 24);
        for (const destination of queries) {
            const point = await geocoder.geocodeQuery(destination.query);
            if (!point) continue;
            rememberTravelCityCoordinate({
                city: destination.city,
                country: destination.country,
                latitude: point.lat,
                longitude: point.lng,
            });
        }
    }

    async function hydrateTravelStudioCoordinates() {
        travelStudioCoordinates = [];
        if (typeof D.StudioLocations?.listPrimaryByStudioIds !== 'function') return;
        const studioIds = [...new Set(trips
            .map(primaryStudioLink)
            .map((link) => link?.studio_id)
            .filter(Boolean))];
        if (!studioIds.length) return;
        try {
            const { data, error } = await D.StudioLocations.listPrimaryByStudioIds(
                studioIds,
                'studio_id, is_active, latitude, longitude, formatted_address, city, country'
            );
            if (error) throw error;
            const seen = new Set();
            travelStudioCoordinates = (data || []).filter((row) => {
                const lat = Number(row.latitude);
                const lng = Number(row.longitude);
                if (seen.has(row.studio_id) || row.is_active === false) return false;
                if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return false;
                seen.add(row.studio_id);
                return true;
            }).map((row) => ({
                id: row.studio_id,
                latitude: Number(row.latitude),
                longitude: Number(row.longitude),
                formatted_address: row.formatted_address || null,
                city: row.city || null,
                country: row.country || null,
                is_active: row.is_active !== false,
            }));
        } catch (err) {
            console.warn('[travel] coordenadas de estudios no disponibles:', err);
        }
    }

    function setupMobileMenu() {
        const toggle = $('tv-mobile-menu-toggle');
        const menu = $('tv-mobile-menu');
        if (!toggle || !menu) return;
        toggle.addEventListener('click', () => {
            const open = menu.hidden;
            menu.hidden = !open;
            toggle.setAttribute('aria-expanded', String(open));
        });
    }

    function wireLogout() {
        const btn = $('tv-logout');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            try { await _supabase.auth.signOut(); } catch (err) { console.warn('[travel] logout:', err); }
            window.location.href = '/artist/login';
        });
    }

    // ============================================
    // DASHBOARD
    // ============================================
    function wireDashboard() {
        $('tv-btn-create').addEventListener('click', openCreate);
        $('tv-hero-previous').addEventListener('click', () => {
            const trip = destinationNavigator?.previous?.();
            if (!trip) return;
            selectedHeroTripId = String(trip.id);
            renderHero();
            renderHeadline();
        });
        $('tv-hero-next').addEventListener('click', () => {
            const trip = destinationNavigator?.next?.();
            if (!trip) return;
            selectedHeroTripId = String(trip.id);
            renderHero();
            renderHeadline();
        });
        $('tv-f-year').addEventListener('change', (e) => { filters.year = e.target.value; renderDashboard(); });
        $('tv-f-status').addEventListener('change', (e) => { filters.status = e.target.value; renderDashboard(); });
        $('tv-f-type').addEventListener('change', (e) => { filters.type = e.target.value; renderDashboard(); });
        $('tv-origin-chips').addEventListener('click', (e) => {
            const chip = e.target.closest('[data-origin]');
            if (!chip) return;
            filters.origin = chip.getAttribute('data-origin');
            renderDashboard();
        });
        $('tv-sort-toggle').addEventListener('click', () => {
            sortAsc = !sortAsc;
            $('tv-sort-label').textContent = sortAsc ? 'Más antiguos primero' : 'Más recientes primero';
            renderTimeline(filteredTrips());
        });
        $('tv-region-tabs').addEventListener('click', (e) => {
            const tab = e.target.closest('[data-region]');
            if (!tab) return;
            filters.region = tab.getAttribute('data-region');
            renderDashboard();
        });
        $('tv-agenda-list').addEventListener('click', (e) => {
            const row = e.target.closest('[data-trip]');
            if (row) openTrip(row.getAttribute('data-trip'));
        });
        $('tv-agenda-list').addEventListener('keydown', (e) => {
            const row = e.target.closest('[data-trip]');
            if (row && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                openTrip(row.getAttribute('data-trip'));
            }
        });
        const previewTravelSelection = (e) => {
            const item = e.target.closest('[data-trip]');
            if (item) selectTravelStop(item.getAttribute('data-trip'));
        };
        $('tv-agenda-list').addEventListener('pointerover', previewTravelSelection);
        $('tv-agenda-list').addEventListener('focusin', previewTravelSelection);
        $('tv-timeline').addEventListener('click', (e) => {
            const item = e.target.closest('[data-trip]');
            if (item) openTrip(item.getAttribute('data-trip'));
        });
        $('tv-timeline').addEventListener('pointerover', previewTravelSelection);
        $('tv-timeline').addEventListener('focusin', previewTravelSelection);
        $('tv-globe').addEventListener('travel-stop-select', (event) => {
            selectedGlobeTripId = String(event.detail?.id || '');
            syncTravelSelectionDom();
        });
        $('tv-globe').addEventListener('travel-view-trip', (event) => {
            const id = event.detail?.id;
            if (id) openTrip(id);
        });
        $('tv-passport-grid').addEventListener('click', (e) => {
            if (e.target.closest('[data-act="next-stamp"]')) openCreate();
        });
    }

    function filteredTrips() {
        return trips.filter((t) => {
            if (filters.region !== 'global' && tripRegion(t) !== filters.region) return false;
            if (filters.year !== 'all' && String(pd(t.start_date).getFullYear()) !== filters.year) return false;
            if (filters.status !== 'all' && dStatus(t) !== filters.status) return false;
            if (filters.type !== 'all' && t.trip_type !== filters.type) return false;
            if (filters.origin !== 'all' && t.origin !== filters.origin) return false;
            return true;
        });
    }

    function nextTrip() {
        const model = window.TravelDashboardModel;
        if (!model) return null;
        const rows = model.buildUpcomingDestinations(
            trips.map((trip) => ({ ...trip, status: dStatus(trip) })),
            { today: today() }
        );
        const retainedId = selectedHeroTripId || destinationNavigator?.selected?.id || null;
        destinationNavigator = model.createDestinationNavigator(rows, retainedId);
        selectedHeroTripId = destinationNavigator.selected?.id ? String(destinationNavigator.selected.id) : null;
        return destinationNavigator.selected;
    }

    function renderDashboard() {
        renderHero();
        renderHeadline();
        renderRegionTabs();
        renderYearOptions();
        syncFilterControls();
        const list = filteredTrips();
        renderCounters(list);
        renderGlobe(list);
        renderAgenda(list);
        renderTimeline(list);
        syncTravelSelectionDom();
        renderPassport();
        refreshIcons($('tv-view-dashboard'));
    }

    function renderHero() {
        const t = nextTrip();
        const hero = $('tv-hero');
        if (!t) { hero.hidden = true; return; }
        hero.hidden = false;
        $('tv-hero-city').textContent = `${t.city}, ${t.country}`;
        $('tv-hero-meta').textContent = `${fmtShortHero(t.start_date)} – ${fmtShortHero(t.end_date)} · ${TYPE_LABELS[t.trip_type] || t.trip_type}`;
        const metrics = window.TravelDashboardModel.buildDestinationMetrics(t, { today: today() });
        $('tv-stat-days').textContent = isOngoing(t) ? 'Hoy' : (metrics.daysRemaining == null ? '—' : String(metrics.daysRemaining));
        $('tv-stat-interested').textContent = metrics.interestedPeople == null ? '—' : String(metrics.interestedPeople);
        $('tv-stat-stay').textContent = metrics.stayDays == null ? '—' : String(metrics.stayDays);
        $('tv-stat-climate').textContent = metrics.climateCelsius == null ? '—' : `${metrics.climateCelsius}°`;
        $('tv-stat-climate-city').textContent = t.city || '—';
        $('tv-stat-studios').textContent = metrics.confirmedStudioCount == null ? '—' : String(metrics.confirmedStudioCount);
        const position = destinationNavigator.selectedIndex + 1;
        const total = destinationNavigator.canNext || destinationNavigator.canPrevious
            ? window.TravelDashboardModel.buildUpcomingDestinations(trips.map((trip) => ({ ...trip, status: dStatus(trip) })), { today: today() }).length
            : 1;
        $('tv-hero-position').textContent = `${position} / ${total}`;
        $('tv-hero-previous').disabled = !destinationNavigator.canPrevious;
        $('tv-hero-next').disabled = !destinationNavigator.canNext;
    }

    function renderHeadline() {
        const t = nextTrip();
        const h = $('tv-headline');
        if (!t) { h.textContent = 'Tu próxima gira empieza acá.'; return; }
        if (isOngoing(t)) {
            h.innerHTML = `<span class="wo-highlight">${esc(t.city)}</span> es tu destino, ahora mismo.`;
            return;
        }
        const days = daysDiff(today(), pd(t.start_date));
        const when = days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`;
        h.innerHTML = `<span class="wo-highlight">${esc(t.city)}</span> es tu próximo destino, ${when}.`;
    }

    function renderRegionTabs() {
        const tabs = ['global', 'sudamerica', 'europa', 'norteamerica'];
        $('tv-region-tabs').innerHTML = tabs.map((r) => {
            const label = r === 'global' ? 'Global' : REGION_LABELS[r];
            const active = filters.region === r ? ' is-active' : '';
            return `<button type="button" class="wo-tab${active}" data-region="${r}" role="tab" aria-selected="${filters.region === r}">${esc(label)}</button>`;
        }).join('');
    }

    function renderYearOptions() {
        const years = [...new Set(trips.map((t) => pd(t.start_date).getFullYear()))].sort((a, b) => b - a);
        const sel = $('tv-f-year');
        sel.innerHTML = '<option value="all">Todos los años</option>'
            + years.map((y) => `<option value="${y}">${y}</option>`).join('');
        sel.value = years.map(String).includes(filters.year) ? filters.year : 'all';
        filters.year = sel.value;
    }

    function syncFilterControls() {
        $('tv-f-status').value = filters.status;
        $('tv-f-type').value = filters.type;
        document.querySelectorAll('#tv-origin-chips [data-origin]').forEach((chip) => {
            const on = chip.getAttribute('data-origin') === filters.origin;
            chip.classList.toggle('is-active', on);
            chip.setAttribute('aria-pressed', String(on));
        });
    }

    function renderCounters(list) {
        const c = list.filter((t) => dStatus(t) === 'confirmado').length;
        const p = list.filter((t) => ['pendiente', 'planificado'].includes(dStatus(t))).length;
        const f = list.filter((t) => dStatus(t) === 'finalizado').length;
        const x = list.filter((t) => dStatus(t) === 'cancelado').length;
        let txt = `${c} confirmados · ${p} pendientes · ${f} finalizados`;
        if (x) txt += ` · ${x} cancelados`;
        $('tv-counters').textContent = txt;
    }

    function renderGlobe(list) {
        const globalGlobe = $('tv-globe');
        const routeTrips = window.TravelDashboardModel.buildUpcomingDestinations(
            list.map((trip) => ({ ...trip, status: dStatus(trip) })),
            { today: today() }
        );
        globalGlobe.setTravelData({
            artist,
            trips: routeTrips.map((trip) => ({
                ...trip,
                personal_notes: visibleTripNotes(trip),
            })),
            studioLocations: travelStudioCoordinates.map((location) => ({ ...location, studio_id: location.id })),
            cityCoordinates: travelCityCoordinates,
            selectedStopId: selectedGlobeTripId,
        });
        selectedGlobeTripId = globalGlobe.selectedId;
        syncTravelSelectionDom();
        return;

    }
    function renderAgenda(list) {
        const n = today();
        const upcoming = list
            .filter((t) => ['planificado', 'pendiente', 'confirmado'].includes(dStatus(t))
                && pd(t.end_date) >= n)
            .sort((a, b) => pd(a.start_date) - pd(b.start_date))
            .slice(0, 5);
        const box = $('tv-agenda-list');
        if (!upcoming.length) {
            box.innerHTML = `
                <div class="wo-empty tvl-agenda-empty">
                    <i data-wo-icon="map" aria-hidden="true"></i>
                    <span class="wo-empty-title">Sin viajes próximos</span>
                    <p>Creá un viaje para empezar a armar tu gira.</p>
                </div>`;
            return;
        }
        box.innerHTML = upcoming.map((t) => {
            const st = dStatus(t);
            const studio = tripStudioName(t) || t.event_name;
            const line2 = `${fmtRange(t)}${studio ? ' · ' + esc(studio) : ''}`;
            const selected = String(t.id) === String(selectedGlobeTripId || '') ? ' is-selected' : '';
            const current = selected ? ' aria-current="true"' : '';
            return `
                <div class="tvl-agenda-row${selected}" data-trip="${t.id}" role="link" tabindex="0"${current} aria-label="Ver viaje a ${esc(t.city)}">
                    <span class="tvl-agenda-dot tvl-dot--${st === 'confirmado' ? 'confirmado' : st === 'finalizado' ? 'finalizado' : 'pendiente'}"></span>
                    <div>
                        <span class="tvl-agenda-city">${esc(t.city)}</span>
                        <span class="tvl-agenda-sub">${esc(t.country)} · ${esc(TYPE_LABELS[t.trip_type] || t.trip_type)}</span>
                        <span class="tvl-agenda-sub">${line2}</span>
                    </div>
                </div>`;
        }).join('');
    }

    function renderTimeline(list) {
        const figmaDemo = list.length > 0 && list.every(isFigmaDemoTrip);
        const effectiveAsc = figmaDemo ? !sortAsc : sortAsc;
        const sorted = [...list].sort((a, b) => effectiveAsc
            ? pd(a.start_date) - pd(b.start_date)
            : pd(b.start_date) - pd(a.start_date));
        const box = $('tv-timeline');
        if (!sorted.length) {
            box.innerHTML = '<p class="tvl-tl-empty">Todavía no hay viajes en esta vista.</p>';
            return;
        }
        box.innerHTML = sorted.map((t) => {
            const st = dStatus(t);
            const selected = String(t.id) === String(selectedGlobeTripId || '') ? ' is-selected' : '';
            const current = selected ? ' aria-current="true"' : '';
            return `
                <button type="button" class="tvl-tl-item tvl-tl-item--${st}${selected}" data-trip="${t.id}"${current}>
                    <span class="tvl-tl-date">${fmtShort(t.start_date)}</span>
                    <span class="tvl-tl-city">${esc(t.city)}</span>
                    <span class="tvl-tl-type">${esc(TYPE_LABELS[t.trip_type] || t.trip_type)}</span>
                    <span class="tvl-tl-status tvl-tl-status--${st}">${esc(TL_STATUS_LABELS[st])}</span>
                </button>`;
        }).join('');
    }

    // Tattoo passport: agregación client-side de viajes finalizados por ciudad.
    function renderPassport() {
        let stamps;
        if (Array.isArray(passportStamps)) {
            stamps = passportStamps.map((stamp) => ({
                city: stamp.city,
                country: stamp.country,
                count: Number(stamp.tattoo_count) || 0,
                studioCount: Number(stamp.studio_count) || 0,
                year: Number(stamp.year) || 0,
            }));
        } else {
            const done = trips.filter((t) => dStatus(t) === 'finalizado');
            const byCity = new Map();
            done.forEach((t) => {
                const key = `${normalize(t.city)}|${normalize(t.country)}`;
                if (!byCity.has(key)) byCity.set(key, { city: t.city, country: t.country, count: 0, studios: new Set(), year: 0 });
                const stamp = byCity.get(key);
                stamp.count += 1;
                const name = tripStudioName(t);
                if (name) stamp.studios.add(normalize(name));
                stamp.year = Math.max(stamp.year, pd(t.end_date).getFullYear());
            });
            stamps = [...byCity.values()].map((stamp) => ({ ...stamp, studioCount: stamp.studios.size }))
                .sort((a, b) => b.year - a.year);
        }
        $('tv-passport-count').textContent = `${stamps.length} stamps`;
        const cards = stamps.map((s) => {
            const tattoos = `${s.count} Tattoos`;
            const est = `${s.studioCount} ${s.studioCount === 1 ? 'Estudio' : 'Estudios'}`;
            return `
                <div class="tvl-stamp">
                    <span class="tvl-stamp-ic"><i data-wo-icon="feather" aria-hidden="true"></i></span>
                    <span class="tvl-stamp-city">${esc(s.city)}</span>
                    <span class="tvl-stamp-country">${esc(s.country)}</span>
                    <span class="tvl-stamp-line"><span>${tattoos}</span><span>${est}</span></span>
                    <span class="tvl-stamp-year">${s.year}</span>
                </div>`;
        });
        cards.push(`
            <button type="button" class="tvl-stamp tvl-stamp--next" data-act="next-stamp" aria-label="Crear un viaje nuevo">
                <span class="tvl-stamp-plus">+</span>
                <span class="wo-meta-s">Next stamp</span>
            </button>`);
        $('tv-passport-grid').innerHTML = cards.join('');
    }

    // ============================================
    // CREAR VIAJE + ÉXITO
    // ============================================
    function setCreateStudioResults(rows, message = '') {
        const box = $('tvc-studio-results');
        const input = $('tvc-studio');
        createStudioRows = Array.isArray(rows) ? rows : [];
        if (!createStudioRows.length) {
            box.innerHTML = message ? `<p class="tvc-suggestions-empty">${esc(message)}</p>` : '';
            box.hidden = !message;
            input.setAttribute('aria-expanded', String(Boolean(message)));
            return;
        }
        box.innerHTML = createStudioRows.map((studio, index) => `
            <button type="button" class="tvc-suggestion" id="tvc-studio-option-${index}" role="option" tabindex="-1" aria-selected="false" data-create-studio="${esc(studio.id)}">
                <span><strong>${esc(studio.name)}</strong><span>${esc([studio.city, studio.country].filter(Boolean).join(' · ') || 'Ubicación no informada')}</span></span>
                <i data-wo-icon="arrow-right" aria-hidden="true"></i>
            </button>`).join('');
        box.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        refreshIcons(box);
    }

    function closeCreateStudioResults() {
        $('tvc-studio-results').hidden = true;
        $('tvc-studio').setAttribute('aria-expanded', 'false');
        $('tvc-studio').removeAttribute('aria-activedescendant');
    }

    async function searchCreateStudios(query) {
        const token = ++createStudioSearchToken;
        try {
            const { data, error } = await D.Studios.searchTravelDirectory(query || '', { limit: 8 });
            if (error) throw error;
            if (token !== createStudioSearchToken || createFormState?.venueMode !== 'studio') return;
            setCreateStudioResults(data || [], (data || []).length ? '' : 'No encontramos estudios registrados con ese nombre.');
        } catch (error) {
            if (token !== createStudioSearchToken) return;
            console.error('[travel] autocompletar estudio:', error);
            setCreateStudioResults([], 'No pudimos cargar los estudios. Probá de nuevo.');
        }
    }

    function scheduleCreateStudioSearch(query) {
        if (createStudioSearchTimer != null) clearTimeout(createStudioSearchTimer);
        createStudioSearchTimer = setTimeout(() => {
            createStudioSearchTimer = null;
            searchCreateStudios(query);
        }, 220);
    }

    function configureCreateVenueMode() {
        const input = $('tvc-studio');
        const label = $('tvc-venue-label');
        const help = $('tvc-venue-help');
        const convention = createFormState?.venueMode === 'place';
        createVenuePicker?.detach?.();
        createVenuePicker = null;
        createStudioSearchToken += 1;
        closeCreateStudioResults();
        input.value = '';
        if (convention) {
            label.textContent = 'Lugar';
            input.placeholder = 'Buscá el lugar en Google Maps';
            input.setAttribute('aria-autocomplete', 'both');
            input.removeAttribute('aria-controls');
            input.removeAttribute('aria-activedescendant');
            help.textContent = 'Seleccioná un lugar sugerido por Google Maps.';
            createVenuePicker = window.WeOtziAddressPicker?.attach?.(input, {
                types: ['establishment'],
                onChange(address, place) {
                    if (!address?.google_place_id) return;
                    const selected = createFormState.selectPlace(address, place);
                    if (!selected) return;
                    rememberTravelCityCoordinate(address);
                    input.value = selected.name;
                    $('tvc-city').value = createFormState.location.city;
                    $('tvc-country').value = createFormState.location.country;
                },
            }) || null;
        } else {
            label.textContent = 'Estudio (opcional)';
            input.placeholder = 'Buscá un estudio registrado';
            input.setAttribute('aria-autocomplete', 'list');
            input.setAttribute('aria-controls', 'tvc-studio-results');
            help.textContent = 'Solo podés elegir estudios activos registrados en We Ötzi.';
        }
    }

    function openCreate() {
        $('tv-create-form').reset();
        createFormState?.reset?.();
        configureCreateVenueMode();
        createStudioRows = [];
        createStudioSearchToken += 1;
        $('tvc-error').hidden = true;
        openModal('tv-modal-create');
    }

    function wireCreate() {
        createCityPicker = window.WeOtziAddressPicker?.attach?.($('tvc-city'), {
            types: ['(cities)'],
            onChange(address) {
                if (!address?.google_place_id) return;
                createFormState?.selectCity?.(address);
                rememberTravelCityCoordinate(address);
                $('tvc-city').value = createFormState.location.city;
                $('tvc-country').value = createFormState.location.country;
            },
        }) || null;
        createCountryPicker = window.WeOtziAddressPicker?.attach?.($('tvc-country'), {
            types: ['(regions)'],
            onChange(address) {
                if (!address?.google_place_id || !address.country) return;
                createFormState?.selectCountry?.(address);
                $('tvc-country').value = createFormState.location.country;
            },
        }) || null;

        $('tvc-city').addEventListener('input', (event) => createFormState?.changeCity?.(event.target.value));
        $('tvc-country').addEventListener('input', (event) => createFormState?.changeCountry?.(event.target.value));
        $('tvc-type').addEventListener('change', (event) => {
            createFormState?.setType?.(event.target.value);
            configureCreateVenueMode();
        });
        $('tvc-studio').addEventListener('focus', () => {
            if (createFormState?.venueMode === 'studio') scheduleCreateStudioSearch($('tvc-studio').value.trim());
        });
        $('tvc-studio').addEventListener('input', (event) => {
            createFormState?.changeVenue?.(event.target.value);
            if (createFormState?.venueMode === 'studio') scheduleCreateStudioSearch(event.target.value.trim());
            else closeCreateStudioResults();
        });
        $('tvc-studio').addEventListener('keydown', (event) => {
            if (createFormState?.venueMode !== 'studio') return;
            const options = [...$('tvc-studio-results').querySelectorAll('[role="option"]')];
            if (!options.length || !['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
            event.preventDefault();
            const current = options.findIndex((option) => option.getAttribute('aria-selected') === 'true');
            if (event.key === 'Escape') { closeCreateStudioResults(); return; }
            if (event.key === 'Enter') {
                options[Math.max(0, current)].click();
                return;
            }
            const next = event.key === 'ArrowDown'
                ? Math.min(options.length - 1, current + 1)
                : Math.max(0, current <= 0 ? options.length - 1 : current - 1);
            options.forEach((option, index) => option.setAttribute('aria-selected', String(index === next)));
            $('tvc-studio').setAttribute('aria-activedescendant', options[next].id);
            options[next].scrollIntoView({ block: 'nearest' });
        });
        $('tvc-studio-results').addEventListener('mousedown', (event) => event.preventDefault());
        $('tvc-studio-results').addEventListener('click', (event) => {
            const option = event.target.closest('[data-create-studio]');
            if (!option) return;
            const studio = createStudioRows.find((row) => String(row.id) === option.getAttribute('data-create-studio'));
            if (!studio) return;
            createFormState?.selectStudio?.(studio);
            $('tvc-studio').value = studio.name;
            closeCreateStudioResults();
            $('tvc-studio').focus();
        });
        $('tvc-studio').addEventListener('blur', () => setTimeout(closeCreateStudioResults, 120));

        $('tv-create-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const err = $('tvc-error');
            err.hidden = true;
            const city = $('tvc-city').value.trim();
            const country = $('tvc-country').value.trim();
            const start = $('tvc-start').value;
            const end = $('tvc-end').value;
            if (!city || !country || !start || !end) return;
            if (end < start) {
                err.textContent = 'La fecha de regreso no puede ser anterior a la de inicio.';
                err.hidden = false;
                return;
            }
            const venue = createFormState?.validateVenue?.($('tvc-studio').value.trim()) || { valid: true };
            if (!venue.valid) {
                err.textContent = venue.reason;
                err.hidden = false;
                $('tvc-studio').focus();
                return;
            }
            const btn = $('tvc-submit');
            btn.disabled = true;
            let creationResult;
            try {
                const selectedStudioForTrip = createFormState?.selectedStudio || null;
                const selectedPlaceForTrip = createFormState?.place || null;
                creationResult = await window.TravelFormModel.createTravelWithVenue({
                    travel: D.Travel,
                    payload: {
                        artist_user_id: session.user.id,
                        city,
                        country,
                        region: deriveRegion(country),
                        start_date: start,
                        end_date: end,
                        trip_type: $('tvc-type').value,
                        studio_name_hint: selectedStudioForTrip?.name || null,
                        personal_notes: $('tvc-notes').value.trim() || null,
                        origin: 'manual',
                        status: 'planificado',
                    },
                    selectedStudio: selectedStudioForTrip,
                    selectedPlace: selectedPlaceForTrip,
                });
            } catch (ex) {
                console.error('[travel] error creando viaje:', ex);
                err.textContent = 'No pudimos crear el viaje. Probá de nuevo.';
                err.hidden = false;
                btn.disabled = false;
                return;
            }

            btn.disabled = false;
            if (creationResult.partial) {
                console.error('[travel] viaje creado con configuración pendiente:', creationResult.completionError);
            }
            lastCreated = creationResult.trip;
            closeModal('tv-modal-create', { restoreFocus: false });
            fillSuccess(creationResult.trip, creationResult.pendingAction);
            showView('success');
            focusViewTarget('tv-s-title');
            try {
                await loadTrips();
            } catch (loadError) {
                console.error('[travel] viaje creado; no se pudo actualizar el panel:', loadError);
            }
        });
    }

    function fillSuccess(trip, pendingAction = null) {
        const partialMessage = pendingAction === 'place'
            ? ' El viaje quedó guardado, pero el lugar quedó pendiente. No vuelvas a crear el viaje.'
            : pendingAction === 'studio'
                ? ' El viaje quedó guardado, pero no pudimos solicitar el vínculo con el estudio. Podés intentarlo desde el detalle.'
                : ' Vas a poder editarlo o completarlo más adelante.';
        $('tv-s-body').textContent = `Tu viaje a ${trip.city} ya forma parte de Travel.${partialMessage}`;
        $('tv-s-status').textContent = STATUS_LABELS[trip.status] || trip.status;
        $('tv-s-citycountry').textContent = `${trip.city}, ${trip.country}`;
        $('tv-s-dates').textContent = fmtRange(trip);
        $('tv-s-type').textContent = TYPE_LABELS[trip.trip_type] || trip.trip_type;
    }

    function wireSuccess() {
        $('tv-s-goto').addEventListener('click', async () => {
            if (lastCreated?.id) {
                await openTrip(lastCreated.id);
                return;
            }
            history.pushState({}, '', travelPath());
            renderDashboard();
            showView('dashboard');
        });
        $('tv-s-another').addEventListener('click', () => {
            renderDashboard();
            showView('dashboard');
            openCreate();
        });
    }

    // ============================================
    // DETALLE
    // ============================================
    async function openTrip(id, { push = true } = {}) {
        let trip = null;
        try {
            trip = await D.Travel.getById(id);
        } catch (err) {
            console.error('[travel] error abriendo viaje:', err);
        }
        if (!trip) {
            history.replaceState({}, '', travelPath());
            renderDashboard();
            showView('dashboard');
            return;
        }
        currentTrip = trip;
        if (push) history.pushState({}, '', travelPath(id));
        linkedStudioInfo = null;
        const primary = primaryStudioLink(trip);
        if (primary && primary.studio_id) {
            try {
                const { data } = await D.Studios.getById(primary.studio_id, 'id, name, city, country, formatted_address');
                linkedStudioInfo = data || null;
            } catch (err) { linkedStudioInfo = null; }
        }
        renderDetail();
        showView('detail');
    }

    async function refreshDetail() {
        if (!currentTrip) return;
        await openTrip(currentTrip.id, { push: false });
        await loadTrips();
    }

    function renderDetail() {
        const t = currentTrip;
        const st = dStatus(t);
        const links = (t.trip_studio_links || []);
        const primary = primaryStudioLink(t);
        const isConvention = t.trip_type === 'convencion';
        const venueLabel = isConvention ? 'Lugar' : 'Estudio';
        const venueName = isConvention ? (t.event_name || '—') : (primary ? primary.studio_name : (t.studio_name_hint || '—'));
        const venueAddress = isConvention
            ? [t.city, t.country].filter(Boolean).join(', ')
            : ((primary && primary.address_snapshot) || (linkedStudioInfo && linkedStudioInfo.formatted_address) || '—');
        const waiting = primary?.status === 'esperando_confirmacion';
        const detailStatus = detailStatusForTrip(t);
        const contactName = (primary && primary.contact_name) || t.contact_name || '—';
        const contactDetail = (primary && primary.contact_details) || t.contact_details || '—';
        const n = today();
        const future = pd(t.start_date) > n;
        const countdown = st === 'cancelado' || st === 'finalizado' ? ''
            : isOngoing(t) ? '<span class="tvd-countdown">En curso</span>'
                : future ? `<span class="tvd-countdown">Faltan ${daysDiff(n, pd(t.start_date))} días</span>` : '';

        const checklist = [...(t.trip_checklist_items || [])].sort((a, b) => (a.sort_order - b.sort_order) || String(a.id).localeCompare(String(b.id)));
        const doneCount = checklist.filter((c) => c.is_done).length;
        const pct = checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0;

        const docs = [...(t.trip_documents || [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

        $('tv-detail-root').innerHTML = `
            <button type="button" class="tvd-back" data-act="back"><i data-wo-icon="arrow-left" class="wo-icon-18" aria-hidden="true"></i>Volver a Travel</button>

            <div class="tvd-tags">
                <span class="${STATUS_TAG_CLASS[detailStatus]}" id="tvd-status-tag">${esc(STATUS_LABELS[detailStatus])}</span>
                <span class="wo-tag wo-tag--filled">${esc(TYPE_LABELS[t.trip_type] || t.trip_type)}</span>
                ${countdown}
            </div>
            <h1 class="wo-h1 tvd-title" id="tvd-title" tabindex="-1">${esc(t.city)}, ${esc(t.country)}</h1>
            <p class="tvd-dates">${fmtRangeLong(t)}</p>

            <div class="tvd-stats">
                <div class="tvd-stat"><span class="tvd-stat-v">${daysDiff(pd(t.start_date), pd(t.end_date))} días</span><span class="tvd-stat-l">Duración</span></div>
                <div class="tvd-stat"><span class="tvd-stat-v">${esc(t.city)}</span><span class="tvd-stat-l">Ciudad</span></div>
                <div class="tvd-stat"><span class="tvd-stat-v">${esc(t.country)}</span><span class="tvd-stat-l">País</span></div>
                <div class="tvd-stat"><span class="tvd-stat-v">${esc(venueName)}</span><span class="tvd-stat-l">${venueLabel}</span></div>
                <div class="tvd-stat"><span class="tvd-stat-v">${esc(TYPE_LABELS[t.trip_type] || t.trip_type)}</span><span class="tvd-stat-l">Tipo de viaje</span></div>
                <div class="tvd-stat"><span class="tvd-stat-v">${esc(STATUS_LABELS[detailStatus])}</span><span class="tvd-stat-l">Estado</span></div>
            </div>

            ${st === 'cancelado' ? `
            <div class="wo-alert wo-alert--error tvd-banner">
                <i data-wo-icon="x-circle" class="wo-icon-18" aria-hidden="true"></i>
                <div><span class="tvd-banner-title">Viaje cancelado</span>
                Podés reactivarlo desde Acciones cuando quieras retomarlo.</div>
            </div>` : waiting ? `
            <div class="wo-alert wo-alert--warning tvd-banner">
                <i data-wo-icon="info" class="wo-icon-18" aria-hidden="true"></i>
                <div><span class="tvd-banner-title">Vinculación pendiente</span>
                Este viaje permanecerá privado hasta que el estudio confirme la vinculación. Una vez confirmada, aparecerá públicamente en tu perfil y quedará asociado al estudio correspondiente.</div>
            </div>` : ''}

            <div class="tvd-grid">
                <div class="tvd-main">
                    <section class="tvd-block" aria-label="Información del destino">
                        <h2 class="wo-h2 tvd-h2">Información del destino</h2>
                        <div class="tvd-info">
                            <div class="tvd-info-cell">
                                <span class="tvd-info-l">${venueLabel}</span>
                                <div class="tvd-info-v">${esc(venueName)}
                                    ${primary?.status === 'esperando_confirmacion' ? '<span class="wo-tag wo-tag--highlight tvd-link-status">Esperando confirmación</span>' : ''}
                                </div>
                            </div>
                            <div class="tvd-info-cell">
                                <span class="tvd-info-l">Dirección</span>
                                <div class="tvd-info-v">${esc(venueAddress || '—')}</div>
                            </div>
                            <div class="tvd-info-cell">
                                <span class="tvd-info-l">Contacto</span>
                                <div class="tvd-info-v">${esc(contactName)}</div>
                            </div>
                            <div class="tvd-info-cell">
                                <span class="tvd-info-l">Teléfono / contacto</span>
                                <div class="tvd-info-v">${esc(contactDetail)}</div>
                            </div>
                            ${editableCell('agreed_conditions', 'Condiciones acordadas', t.agreed_conditions)}
                            ${editableCell('personal_notes', 'Tus notas', visibleTripNotes(t))}
                        </div>
                    </section>

                    <section class="tvd-block" aria-label="Documentos y archivos">
                        <div class="tvd-blockhead">
                            <h2 class="wo-h2 tvd-h2">Documentos y archivos</h2>
                            <button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-act="doc-add"><i data-wo-icon="plus" class="wo-icon-18" aria-hidden="true"></i>Adjuntar archivo</button>
                        </div>
                        ${docs.length ? docs.map((d) => `
                        <div class="tvd-doc">
                            <span class="tvd-doc-ic"><i data-wo-icon="${DOC_ICONS[d.category] || 'file'}" class="wo-icon-18" aria-hidden="true"></i></span>
                            <div>
                                <span class="tvd-doc-name">${esc(d.file_name)}</span>
                                <span class="tvd-doc-cat">${esc(DOC_LABELS[d.category] || d.category)}</span>
                            </div>
                            <span class="tvd-doc-actions">
                                <button type="button" class="tvd-doc-act tvd-doc-del tvd-doc-act--danger" data-act="doc-del" data-doc="${esc(d.id)}" data-path="${esc(d.storage_path)}" aria-label="Eliminar ${esc(d.file_name)}"><i data-wo-icon="trash-2" class="wo-icon-18"></i></button>
                                <button type="button" class="tvd-doc-act" data-act="doc-open" data-path="${esc(d.storage_path)}" aria-label="Abrir ${esc(d.file_name)}"><i data-wo-icon="external-link" class="wo-icon-18"></i></button>
                            </span>
                        </div>`).join('') : `
                        <div class="wo-empty tvl-agenda-empty">
                            <i data-wo-icon="folder" aria-hidden="true"></i>
                            <span class="wo-empty-title">Sin documentos</span>
                            <p>Guardá acá pasajes, reservas y contratos del viaje.</p>
                        </div>`}
                    </section>

                    <section class="tvd-block" aria-label="Cronología del viaje">
                        <h2 class="wo-h2 tvd-h2">Cronología del viaje</h2>
                        <div class="tvd-events">${renderEvents(t)}</div>
                    </section>
                </div>

                <aside class="tvd-rail">
                    <div class="tvd-checkcard">
                        <h3 class="wo-h3 tvd-checkcard-title">Checklist del viaje</h3>
                        <div class="tvd-progressrow">
                            <div class="wo-progress tvd-progress"><span style="width:${pct}%"></span></div>
                            <span class="wo-meta">${doneCount} de ${checklist.length}</span>
                        </div>
                        <div class="tvd-checklist">
                            ${checklist.map((c) => `
                            <label class="wo-check">
                                <input type="checkbox" data-item="${c.id}" ${c.is_done ? 'checked' : ''}>
                                <span>${esc(c.label)}</span>
                                ${c.is_custom ? `<button type="button" class="tvd-check-del" data-act="chk-del" data-item="${c.id}" aria-label="Eliminar tarea"><i data-wo-icon="x" class="wo-icon-18"></i></button>` : ''}
                            </label>`).join('')}
                        </div>
                        <div class="tvd-addtask">
                            <input type="text" class="wo-input" id="tvd-newtask" placeholder="Agregar tarea…">
                            <button type="button" class="wo-iconbtn wo-iconbtn--s" data-act="chk-add" aria-label="Agregar tarea"><i data-wo-icon="plus" class="wo-icon-18"></i></button>
                        </div>
                    </div>

                    <div class="tvd-actionscard">
                        <span class="wo-eyebrow">Acciones</span>
                        <div class="tvd-actions">
                        ${st === 'cancelado' ? `
                            <button type="button" class="wo-btn wo-btn--ghost wo-btn--block" data-act="reactivate"><i data-wo-icon="rotate-ccw" class="wo-icon-18" aria-hidden="true"></i>Reactivar viaje</button>
                        ` : `
                            <button type="button" class="wo-btn wo-btn--ghost wo-btn--block" data-act="open-edit"><i data-wo-icon="edit" class="wo-icon-18" aria-hidden="true"></i>Editar viaje</button>
                            <button type="button" class="wo-btn wo-btn--nav" data-act="open-dates"><i data-wo-icon="calendar" class="wo-icon-18" aria-hidden="true"></i>Cambiar fechas</button>
                            ${isConvention ? '' : '<button type="button" class="wo-btn wo-btn--nav" data-act="open-link"><i data-wo-icon="link" class="wo-icon-18" aria-hidden="true"></i>Vincular un estudio</button>'}
                            <button type="button" class="wo-btn wo-btn--nav" data-act="open-share"><i data-wo-icon="share-2" class="wo-icon-18" aria-hidden="true"></i>Compartir itinerario</button>
                            <button type="button" class="wo-btn wo-btn--nav tvd-action-danger" data-act="open-cancel"><i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i>Cancelar viaje</button>
                        `}
                        </div>
                    </div>
                </aside>
            </div>`;
        refreshIcons($('tv-detail-root'));
    }

    function editableCell(field, label, value) {
        return `
            <div class="tvd-info-cell tvd-info-cell--full" data-fieldcell="${field}">
                <span class="tvd-info-l">${esc(label)}
                    <button type="button" class="tvd-doc-act tvd-edit-btn" data-act="edit-field" data-field="${field}" aria-label="Editar ${esc(label.toLowerCase())}"><i data-wo-icon="edit-2" class="wo-icon-18"></i></button>
                </span>
                <div class="tvd-info-v tvd-info-v--body" data-view>${esc(value || '—')}</div>
                <div class="tvd-editarea" data-editor hidden>
                    <textarea class="wo-textarea" data-input>${esc(value || '')}</textarea>
                    <div class="tvd-editarea-actions">
                        <button type="button" class="wo-btn wo-btn--ghost wo-btn--s" data-act="cancel-field" data-field="${field}">Cancelar</button>
                        <button type="button" class="wo-btn wo-btn--s" data-act="save-field" data-field="${field}">Guardar</button>
                    </div>
                </div>
            </div>`;
    }

    function renderEvents(t) {
        const EVENT_META = {
            creado: { label: 'Viaje creado', color: 'var(--neutral-500)' },
            estudio_confirmado: { label: 'Estudio confirmado', color: 'var(--blue-400)' },
            pasajes_agregados: { label: 'Pasajes agregados', color: 'var(--system-success)' },
            cancelado: { label: 'Viaje cancelado', color: 'var(--red-300)' },
            inicio: { label: 'Inicio del viaje', color: 'var(--yellow-300)' },
            fin: { label: 'Fin del viaje', color: 'var(--neutral-300)' },
        };
        const items = (t.trip_events || []).map((ev) => {
            const meta = EVENT_META[ev.event_type];
            let label = ev.event_type === 'nota' ? (ev.detail || 'Nota') : (meta ? meta.label : ev.event_type);
            if (ev.event_type === 'cancelado' && ev.detail) label += ` · ${ev.detail}`;
            return {
                label,
                color: meta ? meta.color : 'var(--neutral-300)',
                date: ev.event_date,
            };
        });
        if (!(t.trip_events || []).some((event) => event.event_type === 'inicio')) {
            items.push({ label: 'Inicio del viaje', color: 'var(--yellow-300)', date: t.start_date });
        }
        if (!(t.trip_events || []).some((event) => event.event_type === 'fin')) {
            items.push({
                label: 'Fin del viaje',
                color: pd(t.end_date) < today() ? 'var(--neutral-500)' : 'var(--neutral-300)',
                date: t.end_date,
            });
        }
        items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return items.map((it) => `
            <div class="tvd-ev">
                <span class="tvd-ev-dot" style="background:${it.color}"></span>
                <span class="tvd-ev-title">${esc(it.label)}</span>
                <span class="tvd-ev-date">${fmtLong(it.date)}</span>
            </div>`).join('');
    }

    // ---------- Interacción del detalle (delegación) ----------
    function wireDetailStatic() {
        const root = $('tv-detail-root');

        root.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            const t = currentTrip;
            try {
                if (act === 'back') {
                    history.pushState({}, '', travelPath());
                    await loadTrips();
                    renderDashboard();
                    showView('dashboard');
                } else if (act === 'open-edit') {
                    $('tve-city').value = t.city;
                    $('tve-country').value = t.country;
                    $('tve-type').value = t.trip_type;
                    $('tve-notes').value = visibleTripNotes(t);
                    openModal('tv-modal-edit');
                } else if (act === 'open-dates') {
                    $('tvf-start').value = t.start_date;
                    $('tvf-end').value = t.end_date;
                    $('tvf-error').hidden = true;
                    openModal('tv-modal-dates');
                } else if (act === 'open-link') {
                    resetLinkModal();
                    openModal('tv-modal-link');
                } else if (act === 'open-share') {
                    await openShare();
                } else if (act === 'open-cancel') {
                    openModal('tv-modal-cancel');
                } else if (act === 'reactivate') {
                    const links = t.trip_studio_links || [];
                    const status = links.some((l) => l.status === 'confirmada') ? 'confirmado'
                        : links.some((l) => l.status === 'esperando_confirmacion') ? 'pendiente' : 'planificado';
                    await D.Travel.reactivate(t.id, status);
                    await refreshDetail();
                    focusViewTarget('tvd-title');
                } else if (act === 'edit-field') {
                    const cell = btn.closest('[data-fieldcell]');
                    cell.querySelector('[data-view]').hidden = true;
                    cell.querySelector('[data-editor]').hidden = false;
                } else if (act === 'cancel-field') {
                    const cell = btn.closest('[data-fieldcell]');
                    cell.querySelector('[data-view]').hidden = false;
                    cell.querySelector('[data-editor]').hidden = true;
                } else if (act === 'save-field') {
                    const field = btn.getAttribute('data-field');
                    const cell = btn.closest('[data-fieldcell]');
                    let value = cell.querySelector('[data-input]').value.trim();
                    if (field === 'personal_notes' && isFigmaDemoTrip(t)) {
                        value = `${FIGMA_DEMO_MARKER} ${value}`.trim();
                    }
                    await D.Travel.update(t.id, { [field]: value || null });
                    await refreshDetail();
                } else if (act === 'doc-add') {
                    $('tv-doc-form').reset();
                    $('tvdoc-error').hidden = true;
                    openModal('tv-modal-doc');
                } else if (act === 'doc-open') {
                    const path = btn.getAttribute('data-path');
                    const popup = window.open('', '_blank');
                    if (!popup) {
                        window.alert('El navegador bloqueó la nueva pestaña. Habilitá las ventanas emergentes e intentá de nuevo.');
                        return;
                    }
                    popup.opener = null;
                    try {
                        const { data, error } = await _supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
                        if (error || !data?.signedUrl) throw error || new Error('No se recibió una URL firmada.');
                        popup.location.href = data.signedUrl;
                    } catch (openError) {
                        popup?.close();
                        window.alert('No pudimos abrir el documento. Probá de nuevo.');
                        throw openError;
                    }
                } else if (act === 'doc-del') {
                    if (!window.confirm('¿Eliminar este documento del viaje?')) return;
                    const path = btn.getAttribute('data-path');
                    await D.Travel.deleteDocument(btn.getAttribute('data-doc'));
                    try {
                        const { error } = await _supabase.storage.from(BUCKET).remove([path]);
                        if (error && !/not found/i.test(error.message || '')) throw error;
                    } catch (cleanupError) {
                        // La metadata ya no expone un enlace roto; el objeto queda privado y
                        // puede retirarse de forma segura con tooling operativo.
                        console.error('[travel] metadata eliminada; quedó un objeto privado pendiente de limpieza:', cleanupError);
                    }
                    await refreshDetail();
                } else if (act === 'chk-add') {
                    const input = $('tvd-newtask');
                    const label = input.value.trim();
                    if (!label) return;
                    const order = (t.trip_checklist_items || []).length;
                    await D.Travel.addChecklistItem(t.id, label, order);
                    await refreshDetail();
                } else if (act === 'chk-del') {
                    e.preventDefault(); // no togglear el checkbox del label contenedor
                    await D.Travel.deleteChecklistItem(btn.getAttribute('data-item'));
                    await refreshDetail();
                }
            } catch (err) {
                console.error('[travel] acción falló:', act, err);
            }
        });

        // Toggle de checklist (change en checkboxes)
        root.addEventListener('change', async (e) => {
            const cb = e.target.closest('input[data-item]');
            if (!cb) return;
            try {
                await D.Travel.setChecklistDone(cb.getAttribute('data-item'), cb.checked);
                const item = (currentTrip.trip_checklist_items || []).find((c) => c.id === cb.getAttribute('data-item'));
                if (item) item.is_done = cb.checked;
                const done = (currentTrip.trip_checklist_items || []).filter((c) => c.is_done).length;
                const total = (currentTrip.trip_checklist_items || []).length;
                const bar = root.querySelector('.tvd-progress > span');
                if (bar) bar.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
                const counter = root.querySelector('.tvd-progressrow .wo-meta');
                if (counter) counter.textContent = `${done} de ${total}`;
            } catch (err) {
                console.error('[travel] checklist:', err);
                cb.checked = !cb.checked;
            }
        });

        // Enter en "Agregar tarea..."
        root.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.id === 'tvd-newtask') {
                e.preventDefault();
                const btn = root.querySelector('[data-act="chk-add"]');
                if (btn) btn.click();
            }
        });

        // Editar viaje (submit)
        $('tv-edit-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await D.Travel.update(currentTrip.id, {
                    city: $('tve-city').value.trim(),
                    country: $('tve-country').value.trim(),
                    region: deriveRegion($('tve-country').value),
                    trip_type: $('tve-type').value,
                    personal_notes: isFigmaDemoTrip(currentTrip)
                        ? `${FIGMA_DEMO_MARKER} ${$('tve-notes').value.trim()}`.trim()
                        : ($('tve-notes').value.trim() || null),
                });
                closeModal('tv-modal-edit', { restoreFocus: false });
                await refreshDetail();
                focusViewTarget('tvd-title');
            } catch (err) {
                console.error('[travel] editar:', err);
            }
        });

        // Cambiar fechas (submit)
        $('tv-dates-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const start = $('tvf-start').value;
            const end = $('tvf-end').value;
            const err = $('tvf-error');
            if (end < start) {
                err.textContent = 'La fecha de regreso no puede ser anterior a la de inicio.';
                err.hidden = false;
                return;
            }
            try {
                if (typeof D.Travel.updateDates === 'function') {
                    await D.Travel.updateDates(currentTrip.id, start, end);
                } else {
                    await D.Travel.update(currentTrip.id, { start_date: start, end_date: end });
                    await D.Travel.addEvent({
                        tripId: currentTrip.id,
                        eventType: 'nota',
                        detail: `Fechas actualizadas · ${fmtShort(start)} – ${fmtShort(end)}`,
                    });
                }
                closeModal('tv-modal-dates', { restoreFocus: false });
                await refreshDetail();
                focusViewTarget('tvd-title');
            } catch (ex) {
                console.error('[travel] fechas:', ex);
                err.textContent = 'No pudimos guardar las fechas. Probá de nuevo.';
                err.hidden = false;
            }
        });

        // Cancelar viaje (confirmación)
        $('tv-cancel-confirm').addEventListener('click', async () => {
            try {
                const reasonInput = $('tv-cancel-reason');
                const reason = reasonInput?.value.trim() || null;
                await D.Travel.cancel(currentTrip.id, reason);
                if (reasonInput) reasonInput.value = '';
                closeModal('tv-modal-cancel', { restoreFocus: false });
                await refreshDetail();
                focusViewTarget('tvd-title');
            } catch (err) {
                console.error('[travel] cancelar:', err);
            }
        });
    }

    // ---------- Modal vincular un estudio ----------
    function resetLinkModal() {
        selectedStudio = null;
        linkDirectoryRows = [];
        $('tvl-search').value = '';
        $('tvl-city').innerHTML = '<option value="">Ciudad</option>';
        $('tvl-country').innerHTML = '<option value="">País</option>';
        $('tvl-specialty').value = '';
        renderLinkPrompt();
        syncLinkSubmit();
        loadLinkDirectory('', false);
    }

    function syncLinkSubmit() {
        $('tvl-submit').disabled = !selectedStudio;
    }

    function wireLinkModal() {
        $('tvl-search').addEventListener('input', (e) => {
            const q = e.target.value.trim();
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => loadLinkDirectory(q, q.length > 0), 250);
        });
        ['tvl-city', 'tvl-country', 'tvl-specialty'].forEach((id) => {
            $(id).addEventListener('change', () => {
                selectedStudio = null;
                syncLinkSubmit();
                renderFilteredLinkResults();
            });
        });

        $('tvl-results').addEventListener('click', (e) => {
            const row = e.target.closest('[data-studio]');
            if (!row) return;
            selectedStudio = {
                id: row.getAttribute('data-studio'),
                name: row.getAttribute('data-name'),
                city: row.getAttribute('data-city') || null,
            };
            document.querySelectorAll('#tvl-results .tvm-result').forEach((r) => r.classList.toggle('is-selected', r === row));
            syncLinkSubmit();
        });

        $('tvl-submit').addEventListener('click', async () => {
            const t = currentTrip;
            if (!selectedStudio || !selectedStudio.id) return;
            $('tvl-submit').disabled = true;
            try {
                await D.Travel.requestStudioLink({ tripId: t.id, studioId: selectedStudio.id });
                closeModal('tv-modal-link', { restoreFocus: false });
                await refreshDetail();
                focusViewTarget('tvd-title');
            } catch (err) {
                console.error('[travel] vincular estudio:', err);
                $('tvl-submit').disabled = false;
            }
        });
    }

    async function loadLinkDirectory(query, renderResults = true) {
        try {
            const { data } = await D.Studios.searchDirectory(query || '', {
                limit: 40,
                columns: 'id, name, city, country, tagline, bio, is_active',
            });
            linkDirectoryRows = (data || []).filter((studio) => studio.is_active !== false);
            populateLinkFilter('tvl-city', 'Ciudad', linkDirectoryRows.map((s) => s.city));
            populateLinkFilter('tvl-country', 'País', linkDirectoryRows.map((s) => s.country));
            selectedStudio = null;
            syncLinkSubmit();
            if (renderResults) renderFilteredLinkResults();
            else renderLinkPrompt();
        } catch (err) {
            console.error('[travel] búsqueda de estudios:', err);
            linkDirectoryRows = [];
            $('tvl-results').innerHTML = `
                <div class="wo-empty tvm-empty">
                    <i data-wo-icon="alert-circle" aria-hidden="true"></i>
                    <span class="wo-empty-title">No pudimos cargar el directorio</span>
                    <p>Reintentá la búsqueda en unos segundos.</p>
                </div>`;
            refreshIcons($('tvl-results'));
        }
    }

    function renderLinkPrompt() {
        $('tvl-results').innerHTML = `
            <div class="wo-empty tvm-empty">
                <i data-wo-icon="search" aria-hidden="true"></i>
                <span class="wo-empty-title">Buscá un estudio para comenzar</span>
                <p>Escribí el nombre del estudio o utilizá los filtros para encontrar estudios por ciudad, país o especialidad.</p>
            </div>`;
        refreshIcons();
    }

    function populateLinkFilter(id, allLabel, values) {
        const select = $(id);
        const current = select.value;
        const options = [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
        select.innerHTML = `<option value="">${esc(allLabel)}</option>` + options.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
        select.value = options.includes(current) ? current : '';
    }

    function renderFilteredLinkResults() {
        const city = $('tvl-city').value;
        const country = $('tvl-country').value;
        const specialty = $('tvl-specialty').value.toLowerCase();
        const rows = linkDirectoryRows.filter((studio) => {
            if (city && studio.city !== city) return false;
            if (country && studio.country !== country) return false;
            const specialties = [studio.tagline, studio.bio]
                .filter(Boolean).join(' ').toLowerCase();
            if (specialty && !specialties.includes(specialty)) return false;
            return true;
        });
        renderLinkResults(rows);
    }

    function renderLinkResults(rows) {
        const box = $('tvl-results');
        if (!rows.length) {
            box.innerHTML = `
                <div class="wo-empty tvm-empty">
                    <i data-wo-icon="search" aria-hidden="true"></i>
                    <span class="wo-empty-title">Sin resultados</span>
                    <p>No encontramos estudios activos con esos filtros.</p>
                </div>`;
            refreshIcons(box);
            return;
        }
        box.innerHTML = rows.map((s) => {
            const sub = [s.city, s.country].filter(Boolean).join(' · ');
            return `
                <button type="button" class="tvm-result" data-studio="${s.id}" data-name="${esc(s.name)}" data-city="${esc(s.city || '')}">
                    <span><span class="tvm-result-name">${esc(s.name)}</span>
                    ${sub ? `<span class="tvm-result-sub">${esc(sub)}</span>` : ''}</span>
                    <i data-wo-icon="chevron-right" class="wo-icon-18" aria-hidden="true"></i>
                </button>`;
        }).join('');
        refreshIcons(box);
    }

    // ---------- Modal compartir itinerario ----------
    function shareUrl(slug) {
        return `https://weotzi.com/travel/t/${slug}`;
    }

    function syncShareModal() {
        const t = currentTrip;
        const url = shareUrl(pendingShareSlug);
        const isEnabled = Boolean(t.share_enabled && t.share_slug === pendingShareSlug);
        const urlInput = $('tvs-url');
        urlInput.value = isEnabled ? url : 'El enlace se activará al copiar';
        urlInput.disabled = !isEnabled;
        $('tvs-copy-label').textContent = 'Copiar';
        const msg = `Itinerario de mi viaje a ${t.city}: ${url}`;
        $('tvs-email').href = isEnabled
            ? `mailto:?subject=${encodeURIComponent(`Itinerario · ${t.city}`)}&body=${encodeURIComponent(msg)}` : '#';
        $('tvs-wa').href = isEnabled ? `https://wa.me/?text=${encodeURIComponent(msg)}` : '#';
        $('tvs-disable').hidden = !t.share_enabled;
    }

    async function openShare() {
        const t = currentTrip;
        try {
            const reusablePendingSlug = pendingShareTripId === t.id ? pendingShareSlug : null;
            pendingShareSlug = t.share_slug || reusablePendingSlug || makeSlug(t);
            pendingShareTripId = t.id;
            syncShareModal();
        } catch (err) {
            console.error('[travel] preparar enlace:', err);
            return;
        }
        openModal('tv-modal-share');
    }

    async function ensureShareEnabled() {
        const t = currentTrip;
        if (!pendingShareSlug || pendingShareTripId !== t.id) {
            pendingShareSlug = t.share_slug || makeSlug(t);
            pendingShareTripId = t.id;
        }
        if (!t.share_enabled || t.share_slug !== pendingShareSlug) {
            await D.Travel.setShare(t.id, { slug: pendingShareSlug, enabled: true });
            t.share_slug = pendingShareSlug;
            t.share_enabled = true;
            syncShareModal();
        }
        return shareUrl(pendingShareSlug);
    }

    async function disableShare() {
        const t = currentTrip;
        if (!t.share_slug || !t.share_enabled) return;
        await D.Travel.setShare(t.id, { slug: t.share_slug, enabled: false });
        t.share_enabled = false;
        pendingShareSlug = t.share_slug;
        pendingShareTripId = t.id;
        syncShareModal();
    }

    function copyShareUrlWithGesture(url) {
        const input = $('tvs-url');
        if (navigator.clipboard?.writeText) {
            // La llamada privilegiada ocurre sincrónicamente dentro del click. El await
            // queda en el caller y no consume la activación transitoria del navegador.
            return navigator.clipboard.writeText(url).catch((clipboardError) => {
                input.select();
                if (document.execCommand('copy')) return;
                throw clipboardError;
            });
        }
        input.select();
        if (!document.execCommand('copy')) return Promise.reject(new Error('Clipboard no disponible.'));
        return Promise.resolve();
    }

    async function copyEnabledShareUrl() {
        const t = currentTrip;
        if (!t.share_enabled || t.share_slug !== pendingShareSlug) {
            // Primer click: publicar de forma segura. Copiar en un segundo click conserva
            // el gesto de usuario sin exponer un slug todavía inactivo.
            await ensureShareEnabled();
            $('tvs-copy-label').textContent = 'Copiar ahora';
            return false;
        }
        const url = shareUrl(pendingShareSlug);
        await copyShareUrlWithGesture(url);
        return true;
    }

    function wireShareModal() {
        $('tvs-copy').addEventListener('click', async () => {
            try {
                const copied = await copyEnabledShareUrl();
                if (!copied) return;
                $('tvs-copy-label').textContent = 'Copiado';
                setTimeout(() => { $('tvs-copy-label').textContent = 'Copiar'; }, 2000);
            } catch (err) {
                console.error('[travel] no pudimos activar o copiar el enlace:', err);
                $('tvs-copy-label').textContent = 'No disponible';
            }
        });
        $('tvs-email').addEventListener('click', async (event) => {
            event.preventDefault();
            try {
                await ensureShareEnabled();
                window.location.href = $('tvs-email').href;
            } catch (err) {
                console.error('[travel] compartir por email:', err);
            }
        });
        $('tvs-wa').addEventListener('click', async (event) => {
            event.preventDefault();
            const popup = window.open('', '_blank');
            try {
                if (!popup) throw new Error('El navegador bloqueó la nueva pestaña.');
                popup.opener = null;
                await ensureShareEnabled();
                popup.location.href = $('tvs-wa').href;
            } catch (err) {
                popup?.close();
                console.error('[travel] compartir por WhatsApp:', err);
            }
        });
        $('tvs-disable').addEventListener('click', async () => {
            try {
                await disableShare();
            } catch (err) {
                console.error('[travel] desactivar enlace:', err);
            }
        });
    }

    // ---------- Modal adjuntar archivo ----------
    function wireDocModal() {
        $('tv-doc-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const t = currentTrip;
            const file = $('tvdoc-file').files[0];
            const err = $('tvdoc-error');
            err.hidden = true;
            if (!file) return;
            if (!ALLOWED_DOCUMENT_TYPES.has(file.type)) {
                err.textContent = 'Elegí un PDF, JPG, PNG o WEBP.';
                err.hidden = false;
                return;
            }
            if (file.size > MAX_DOCUMENT_BYTES) {
                err.textContent = 'El archivo no puede superar los 10 MB.';
                err.hidden = false;
                return;
            }
            const btn = $('tvdoc-submit');
            btn.disabled = true;
            let uploadedPath = null;
            try {
                const safeName = file.name.replace(/[^\w.\-]+/g, '_');
                const path = `${session.user.id}/${t.id}/${Date.now()}_${safeName}`;
                const { error } = await _supabase.storage.from(BUCKET).upload(path, file);
                if (error) throw error;
                uploadedPath = path;
                const category = $('tvdoc-cat').value;
                try {
                    await D.Travel.addDocument({ tripId: t.id, category, fileName: file.name, storagePath: path });
                } catch (metadataError) {
                    const { error: cleanupError } = await _supabase.storage.from(BUCKET).remove([uploadedPath]);
                    if (cleanupError) console.error('[travel] no pudimos compensar el archivo sin metadata:', cleanupError);
                    uploadedPath = null;
                    throw metadataError;
                }
                try {
                    if (category === 'pasaje' && !(t.trip_events || []).some((ev) => ev.event_type === 'pasajes_agregados')) {
                        await D.Travel.addEvent({ tripId: t.id, eventType: 'pasajes_agregados' });
                        const item = (t.trip_checklist_items || []).find((c) => c.label === 'Pasajes comprados' && !c.is_done);
                        if (item) await D.Travel.setChecklistDone(item.id, true);
                    }
                } catch (sideEffectError) {
                    console.warn('[travel] documento guardado; falló la actualización auxiliar:', sideEffectError);
                }
                closeModal('tv-modal-doc', { restoreFocus: false });
                await refreshDetail();
                focusViewTarget('tvd-title');
            } catch (ex) {
                console.error('[travel] subir documento:', ex);
                err.textContent = 'No pudimos subir el archivo. Probá de nuevo.';
                err.hidden = false;
            } finally {
                btn.disabled = false;
            }
        });
    }
})();
