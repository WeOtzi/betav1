// ============================================
// Travel del artista (DS Bauhaus) — refs Figma 68:11882 · 419:2487 · 131:14426
// · 132:14729 · 173:24897 · 173:25982 · 173:26741 · 173:27503 · 173:28256.
// Dashboard de giras + modal crear + éxito + detalle (?trip=<id>) + 5 modales
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

    // Labels canónicos de la checklist (frame 132:14729).
    const CHECKLIST_LABELS = [
        'Pasajes comprados',
        'Hospedaje reservado',
        'Estudio confirmado',
        'Contacté al estudio',
        'Agenda recibida',
        'Equipos preparados',
        'Materiales de trabajo listos',
        'Documentación preparada',
        'Seguro de viaje',
        'Equipaje listo',
    ];

    const TYPE_LABELS = { guest_spot: 'Guest spot', convencion: 'Convención', estudio_invitado: 'Estudio invitado' };
    const STATUS_LABELS = { planificado: 'Planificado', pendiente: 'Pendiente', confirmado: 'Confirmado', finalizado: 'Finalizado', cancelado: 'Cancelado' };
    const TL_STATUS_LABELS = { planificado: 'Planificado', pendiente: 'Pendiente de confirmación', confirmado: 'Confirmado', finalizado: 'Finalizado', cancelado: 'Cancelado' };
    const STATUS_TAG_CLASS = {
        planificado: 'wo-tag',
        pendiente: 'wo-tag wo-tag--highlight',
        confirmado: 'wo-tag wo-tag--info',
        finalizado: 'wo-tag wo-tag--archived',
        cancelado: 'wo-tag wo-tag--urgent',
    };
    const LINK_STATUS_LABELS = {
        esperando_confirmacion: 'Esperando confirmación',
        confirmada: 'Confirmada',
        rechazada: 'Rechazada',
        cancelada: 'Cancelada',
    };
    const LINK_TAG_CLASS = {
        esperando_confirmacion: 'wo-tag wo-tag--highlight',
        confirmada: 'wo-tag wo-tag--active',
        rechazada: 'wo-tag wo-tag--urgent',
        cancelada: 'wo-tag wo-tag--archived',
    };
    const DOC_ICONS = { pasaje: 'file-text', reserva_hotel: 'home', contrato: 'file', otro: 'paperclip' };
    const DOC_LABELS = { pasaje: 'Pasaje', reserva_hotel: 'Reserva de hotel', contrato: 'Contrato', otro: 'Otro' };
    const MONTHS_AB = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const REGION_LABELS = { sudamerica: 'Sudamérica', europa: 'Europa', norteamerica: 'Norteamérica', otro: 'Otras regiones' };
    const REGION_ORDER = ['sudamerica', 'europa', 'norteamerica', 'otro'];

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

    // ---------- Estado ----------
    let session = null;
    let artist = null;
    let trips = [];
    let currentTrip = null;      // detalle (embed completo)
    let linkedStudioInfo = null; // fila de studios del link principal (dirección)
    let lastCreated = null;
    const filters = { region: 'global', year: 'all', status: 'all', type: 'all', origin: 'all' };
    let sortAsc = true;
    let selectedStudio = null;   // modal vincular
    let linkDirectoryRows = [];
    let searchTimer = null;

    // ---------- Utilidades ----------
    const $ = (id) => document.getElementById(id);

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
        const rand = Math.random().toString(36).slice(2, 6);
        return `${slugify(trip.city)}-${MONTHS_AB[d.getMonth()]}${String(d.getFullYear()).slice(2)}-${rand}`;
    }

    // Estado visible: un viaje activo con fecha de regreso pasada se muestra
    // finalizado sin escribir en la base (derivación client-side).
    function dStatus(t) {
        if (t.status === 'cancelado') return 'cancelado';
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
    function tripStudioName(t) {
        const links = t.trip_studio_links || [];
        const best = links.find((l) => l.status === 'confirmada') || links.find((l) => l.status === 'esperando_confirmacion');
        return best ? best.studio_name : (t.studio_name_hint || null);
    }

    // ---------- Vistas ----------
    function showView(name) {
        $('tv-view-dashboard').hidden = name !== 'dashboard';
        $('tv-view-success').hidden = name !== 'success';
        $('tv-view-detail').hidden = name !== 'detail';
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
        const m = $(id);
        if (m) m.hidden = false;
    }
    function closeModal(id) {
        const m = $(id);
        if (m) m.hidden = true;
    }
    function wireModals() {
        document.querySelectorAll('[data-close]').forEach((btn) => {
            btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close')));
        });
        document.querySelectorAll('.tvm-overlay').forEach((ov) => {
            ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov.hidden = true; });
        });
    }

    // ============================================
    // ARRANQUE
    // ============================================
    document.addEventListener('DOMContentLoaded', async () => {
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
            const { data: row } = await D.Artists.getByUserId(session.user.id, 'user_id, name, username, city');
            artist = row || null;
        } catch (err) { artist = null; }

        await loadTrips();
        routeFromUrl();
        window.addEventListener('popstate', routeFromUrl);
    });

    async function loadTrips() {
        try {
            trips = await D.Travel.listForArtist(session.user.id);
        } catch (err) {
            console.error('[travel] error cargando viajes:', err);
            trips = [];
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
        $('tv-timeline').addEventListener('click', (e) => {
            const item = e.target.closest('[data-trip]');
            if (item) openTrip(item.getAttribute('data-trip'));
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
        const n = today();
        const actives = trips.filter((t) => ['planificado', 'pendiente', 'confirmado'].includes(dStatus(t)));
        const ongoing = actives.find(isOngoing);
        if (ongoing) return ongoing;
        return actives
            .filter((t) => pd(t.start_date) >= n)
            .sort((a, b) => pd(a.start_date) - pd(b.start_date))[0] || null;
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
        renderPassport();
    }

    function renderHero() {
        const t = nextTrip();
        const hero = $('tv-hero');
        if (!t) { hero.hidden = true; return; }
        hero.hidden = false;
        $('tv-hero-city').textContent = `${t.city}, ${t.country}`;
        $('tv-hero-meta').textContent = `${fmtRange(t)} · ${TYPE_LABELS[t.trip_type] || t.trip_type}`;
        const n = today();
        const days = Math.max(0, daysDiff(n, pd(t.start_date)));
        $('tv-stat-days').textContent = isOngoing(t) ? 'Hoy' : String(days);
        $('tv-stat-stay').textContent = String(daysDiff(pd(t.start_date), pd(t.end_date)));
        const confirmed = new Set();
        trips.forEach((tr) => {
            if (['planificado', 'pendiente', 'confirmado'].includes(dStatus(tr))) {
                (tr.trip_studio_links || []).forEach((l) => { if (l.status === 'confirmada') confirmed.add(l.studio_name); });
            }
        });
        $('tv-stat-studios').textContent = String(confirmed.size);
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
        const present = new Set(trips.map(tripRegion));
        const tabs = ['global', ...REGION_ORDER.filter((r) => present.has(r))];
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

    // ---------- Globo decorativo (SVG estático, regla 8 del discovery) ----------
    function renderGlobe(list) {
        const anchors = { europa: [540, 128], norteamerica: [248, 140], sudamerica: [318, 328], otro: [552, 296] };
        const base = [400, 342];
        const arcs = [];
        const dots = [];
        list.filter((t) => dStatus(t) !== 'cancelado').slice(0, 8).forEach((t, i) => {
            const a = anchors[tripRegion(t)] || anchors.otro;
            const x = a[0] + ((i % 3) - 1) * 30;
            const y = a[1] + (((i * 7) % 3) - 1) * 22;
            const st = dStatus(t);
            const cls = st === 'confirmado' ? 'confirmado' : st === 'finalizado' ? 'finalizado' : 'pendiente';
            const mx = (base[0] + x) / 2;
            const my = Math.min(base[1], y) - 90;
            arcs.push(`<path class="tvg-arc tvg-arc--${cls}" d="M ${base[0]} ${base[1]} Q ${mx} ${my} ${x} ${y}"/>`);
            dots.push(`<circle class="tvg-dot tvg-dot--${cls}" cx="${x}" cy="${y}" r="7"/>`);
        });
        const baseLabel = artist && artist.city ? `TU BASE · ${esc(String(artist.city).toUpperCase())}` : 'TU BASE';
        $('tv-globe').innerHTML = `
            <svg viewBox="0 0 800 520" role="img" aria-label="Mapa decorativo de rutas de gira" preserveAspectRatio="xMidYMid meet">
                <circle class="tvg-wire" cx="400" cy="252" r="225"/>
                <ellipse class="tvg-wire" cx="400" cy="252" rx="60" ry="225"/>
                <ellipse class="tvg-wire" cx="400" cy="252" rx="130" ry="225"/>
                <ellipse class="tvg-wire" cx="400" cy="252" rx="190" ry="225"/>
                <ellipse class="tvg-wire" cx="400" cy="252" rx="225" ry="55"/>
                <ellipse class="tvg-wire" cx="400" cy="252" rx="225" ry="115"/>
                <ellipse class="tvg-wire" cx="400" cy="252" rx="218" ry="175"/>
                ${arcs.join('')}
                ${dots.join('')}
                <circle class="tvg-base" cx="${base[0]}" cy="${base[1]}" r="8"/>
                <text class="tvg-label" x="${base[0] + 18}" y="${base[1] + 5}">${baseLabel}</text>
            </svg>
            <div class="tvl-globe-legend" aria-hidden="true">
                <span><i class="tvl-dot tvl-dot--confirmado"></i>Confirmado</span>
                <span><i class="tvl-dot tvl-dot--pendiente"></i>Pendiente</span>
                <span><i class="tvl-dot tvl-dot--finalizado"></i>Finalizado</span>
            </div>`;
    }

    function renderAgenda(list) {
        const n = today();
        const upcoming = list
            .filter((t) => ['planificado', 'pendiente', 'confirmado'].includes(dStatus(t)) && pd(t.end_date) >= n)
            .sort((a, b) => pd(a.start_date) - pd(b.start_date))
            .slice(0, 6);
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
            return `
                <div class="tvl-agenda-row" data-trip="${t.id}" role="link" tabindex="0" aria-label="Ver viaje a ${esc(t.city)}">
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
        const sorted = [...list].sort((a, b) => sortAsc
            ? pd(a.start_date) - pd(b.start_date)
            : pd(b.start_date) - pd(a.start_date));
        const box = $('tv-timeline');
        if (!sorted.length) {
            box.innerHTML = '<p class="tvl-tl-empty">Todavía no hay viajes en esta vista.</p>';
            return;
        }
        box.innerHTML = sorted.map((t) => {
            const st = dStatus(t);
            return `
                <button type="button" class="tvl-tl-item tvl-tl-item--${st}" data-trip="${t.id}">
                    <span class="tvl-tl-date">${fmtShort(t.start_date)}</span>
                    <span class="tvl-tl-city">${esc(t.city)}</span>
                    <span class="tvl-tl-type">${esc(TYPE_LABELS[t.trip_type] || t.trip_type)}</span>
                    <span class="tvl-tl-status tvl-tl-status--${st}">${esc(TL_STATUS_LABELS[st])}</span>
                </button>`;
        }).join('');
    }

    // Tattoo passport: agregación client-side de viajes finalizados por ciudad.
    function renderPassport() {
        const done = trips.filter((t) => dStatus(t) === 'finalizado');
        const byCity = new Map();
        done.forEach((t) => {
            const key = `${normalize(t.city)}|${normalize(t.country)}`;
            if (!byCity.has(key)) byCity.set(key, { city: t.city, country: t.country, count: 0, studios: new Set(), year: 0 });
            const s = byCity.get(key);
            s.count += 1;
            const name = tripStudioName(t);
            if (name) s.studios.add(normalize(name));
            s.year = Math.max(s.year, pd(t.end_date).getFullYear());
        });
        const stamps = [...byCity.values()].sort((a, b) => b.year - a.year);
        $('tv-passport-count').textContent = `${stamps.length} stamps`;
        const cards = stamps.map((s) => {
            const vjs = `${s.count} ${s.count === 1 ? 'viaje' : 'viajes'}`;
            const est = `${s.studios.size} ${s.studios.size === 1 ? 'estudio' : 'estudios'}`;
            return `
                <div class="tvl-stamp">
                    <span class="tvl-stamp-ic"><i data-wo-icon="feather" aria-hidden="true"></i></span>
                    <span class="tvl-stamp-city">${esc(s.city)}</span>
                    <span class="tvl-stamp-country">${esc(s.country)}</span>
                    <span class="tvl-stamp-line">${vjs} · ${est}</span>
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
    function openCreate() {
        $('tv-create-form').reset();
        $('tvc-error').hidden = true;
        openModal('tv-modal-create');
    }

    function wireCreate() {
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
            const btn = $('tvc-submit');
            btn.disabled = true;
            try {
                const trip = await D.Travel.create({
                    artist_user_id: session.user.id,
                    city,
                    country,
                    region: deriveRegion(country),
                    start_date: start,
                    end_date: end,
                    trip_type: $('tvc-type').value,
                    studio_name_hint: $('tvc-studio').value.trim() || null,
                    personal_notes: $('tvc-notes').value.trim() || null,
                    origin: 'manual',
                    status: 'planificado',
                });
                await D.Travel.seedChecklist(trip.id, CHECKLIST_LABELS);
                await D.Travel.addEvent({ tripId: trip.id, eventType: 'creado' });
                lastCreated = trip;
                closeModal('tv-modal-create');
                fillSuccess(trip);
                showView('success');
                await loadTrips();
            } catch (ex) {
                console.error('[travel] error creando viaje:', ex);
                err.textContent = 'No pudimos crear el viaje. Probá de nuevo.';
                err.hidden = false;
            } finally {
                btn.disabled = false;
            }
        });
    }

    function fillSuccess(trip) {
        $('tv-s-body').textContent = `Tu viaje a ${trip.city} ya forma parte de Travel. Vas a poder editarlo o completarlo más adelante.`;
        $('tv-s-status').textContent = STATUS_LABELS[trip.status] || trip.status;
        $('tv-s-citycountry').textContent = `${trip.city}, ${trip.country}`;
        $('tv-s-dates').textContent = fmtRange(trip);
        $('tv-s-type').textContent = TYPE_LABELS[trip.trip_type] || trip.trip_type;
    }

    function wireSuccess() {
        $('tv-s-goto').addEventListener('click', () => {
            history.pushState({}, '', '/artist/travel');
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
            history.replaceState({}, '', '/artist/travel');
            renderDashboard();
            showView('dashboard');
            return;
        }
        currentTrip = trip;
        if (push) history.pushState({}, '', `/artist/travel?trip=${id}`);
        linkedStudioInfo = null;
        const primary = (trip.trip_studio_links || []).find((l) => l.status === 'confirmada')
            || (trip.trip_studio_links || []).find((l) => l.status === 'esperando_confirmacion');
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
        const activeLinks = links.filter((l) => l.status !== 'cancelada' && l.status !== 'rechazada');
        const waiting = links.some((l) => l.status === 'esperando_confirmacion');
        const primary = links.find((l) => l.status === 'confirmada') || links.find((l) => l.status === 'esperando_confirmacion');
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
                <span class="${STATUS_TAG_CLASS[st]}">${esc(STATUS_LABELS[st])}</span>
                <span class="wo-tag wo-tag--filled">${esc(TYPE_LABELS[t.trip_type] || t.trip_type)}</span>
                ${countdown}
            </div>
            <h1 class="wo-h1 tvd-title">${esc(t.city)}, ${esc(t.country)}</h1>
            <p class="tvd-dates">${fmtRangeLong(t)}</p>

            <div class="tvd-stats">
                <div class="tvd-stat"><span class="tvd-stat-v">${daysDiff(pd(t.start_date), pd(t.end_date))} días</span><span class="tvd-stat-l">Duración</span></div>
                <div class="tvd-stat"><span class="tvd-stat-v">${esc(t.city)}</span><span class="tvd-stat-l">Ciudad</span></div>
                <div class="tvd-stat"><span class="tvd-stat-v">${esc(t.country)}</span><span class="tvd-stat-l">País</span></div>
                <div class="tvd-stat"><span class="tvd-stat-v">${esc(primary ? primary.studio_name : (t.studio_name_hint || '—'))}</span><span class="tvd-stat-l">Estudio vinculado</span></div>
                <div class="tvd-stat"><span class="tvd-stat-v">${esc(TYPE_LABELS[t.trip_type] || t.trip_type)}</span><span class="tvd-stat-l">Tipo de viaje</span></div>
                <div class="tvd-stat"><span class="tvd-stat-v">${esc(STATUS_LABELS[st])}</span><span class="tvd-stat-l">Estado</span></div>
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
                                <span class="tvd-info-l">Estudio</span>
                                ${activeLinks.length ? activeLinks.map((l) => `
                                    <div class="tvd-info-v">${esc(l.studio_name)}
                                        <span class="${LINK_TAG_CLASS[l.status]}">${esc(LINK_STATUS_LABELS[l.status])}</span>
                                    </div>
                                    ${l.status === 'esperando_confirmacion' ? `
                                    <p class="wo-help">El estudio propietario debe confirmar o rechazar esta solicitud.</p>` : ''}`).join('') : `
                                    <div class="tvd-info-v">${esc(t.studio_name_hint || '—')}</div>
                                    <p class="wo-help">Todavía sin vincular · usá &quot;Vincular un estudio&quot; en Acciones.</p>`}
                            </div>
                            <div class="tvd-info-cell">
                                <span class="tvd-info-l">Ciudad del estudio</span>
                                <div class="tvd-info-v">${esc((primary && primary.studio_city) || (linkedStudioInfo && linkedStudioInfo.city) || '—')}</div>
                            </div>
                            <div class="tvd-info-cell tvd-info-cell--full">
                                <span class="tvd-info-l">Dirección</span>
                                <div class="tvd-info-v tvd-info-v--body">${esc((linkedStudioInfo && linkedStudioInfo.formatted_address) || '—')}</div>
                            </div>
                            ${editableCell('agreed_conditions', 'Condiciones acordadas', t.agreed_conditions)}
                            ${editableCell('personal_notes', 'Tus notas', t.personal_notes)}
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
                            <button type="button" class="tvd-doc-act" data-act="doc-open" data-path="${esc(d.storage_path)}" aria-label="Abrir ${esc(d.file_name)}"><i data-wo-icon="external-link" class="wo-icon-18"></i></button>
                            <button type="button" class="tvd-doc-act tvd-doc-act--danger" data-act="doc-del" data-doc="${d.id}" data-path="${esc(d.storage_path)}" aria-label="Eliminar ${esc(d.file_name)}"><i data-wo-icon="trash-2" class="wo-icon-18"></i></button>
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
                            <input type="text" class="wo-input" id="tvd-newtask" placeholder="Agregar tarea...">
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
                            <button type="button" class="wo-btn wo-btn--nav" data-act="open-link"><i data-wo-icon="link" class="wo-icon-18" aria-hidden="true"></i>Vincular un estudio</button>
                            <button type="button" class="wo-btn wo-btn--nav" data-act="open-share"><i data-wo-icon="share-2" class="wo-icon-18" aria-hidden="true"></i>Compartir itinerario</button>
                            <button type="button" class="wo-btn wo-btn--nav tvd-action-danger" data-act="open-cancel"><i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i>Cancelar viaje</button>
                        `}
                        </div>
                    </div>
                </aside>
            </div>`;
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
        items.push({ label: 'Inicio del viaje', color: 'var(--yellow-300)', date: t.start_date });
        items.push({
            label: 'Fin del viaje',
            color: pd(t.end_date) < today() ? 'var(--neutral-500)' : 'var(--neutral-300)',
            date: t.end_date,
        });
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
                    history.pushState({}, '', '/artist/travel');
                    await loadTrips();
                    renderDashboard();
                    showView('dashboard');
                } else if (act === 'open-edit') {
                    $('tve-city').value = t.city;
                    $('tve-country').value = t.country;
                    $('tve-type').value = t.trip_type;
                    $('tve-notes').value = t.personal_notes || '';
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
                    await D.Travel.addEvent({ tripId: t.id, eventType: 'nota', detail: 'Viaje reactivado' });
                    await refreshDetail();
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
                    const value = cell.querySelector('[data-input]').value.trim();
                    await D.Travel.update(t.id, { [field]: value || null });
                    await refreshDetail();
                } else if (act === 'doc-add') {
                    $('tv-doc-form').reset();
                    $('tvdoc-error').hidden = true;
                    openModal('tv-modal-doc');
                } else if (act === 'doc-open') {
                    const path = btn.getAttribute('data-path');
                    const { data, error } = await _supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
                    if (!error && data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
                } else if (act === 'doc-del') {
                    if (!window.confirm('¿Eliminar este documento del viaje?')) return;
                    const path = btn.getAttribute('data-path');
                    await D.Travel.deleteDocument(btn.getAttribute('data-doc'));
                    try { await _supabase.storage.from(BUCKET).remove([path]); } catch (err) { /* registro ya borrado */ }
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
                    personal_notes: $('tve-notes').value.trim() || null,
                });
                closeModal('tv-modal-edit');
                await refreshDetail();
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
                await D.Travel.update(currentTrip.id, { start_date: start, end_date: end });
                await D.Travel.addEvent({
                    tripId: currentTrip.id,
                    eventType: 'nota',
                    detail: `Fechas actualizadas · ${fmtShort(start)} – ${fmtShort(end)}`,
                });
                closeModal('tv-modal-dates');
                await refreshDetail();
            } catch (ex) {
                console.error('[travel] fechas:', ex);
                err.textContent = 'No pudimos guardar las fechas. Probá de nuevo.';
                err.hidden = false;
            }
        });

        // Cancelar viaje (confirmación)
        $('tv-cancel-confirm').addEventListener('click', async () => {
            try {
                await D.Travel.cancel(currentTrip.id);
                const reason = $('tv-cancel-reason').value.trim();
                await D.Travel.addEvent({ tripId: currentTrip.id, eventType: 'cancelado', detail: reason || null });
                $('tv-cancel-reason').value = '';
                closeModal('tv-modal-cancel');
                await refreshDetail();
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
                closeModal('tv-modal-link');
                await refreshDetail();
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
    }

    // ---------- Modal compartir itinerario ----------
    async function openShare() {
        const t = currentTrip;
        try {
            if (!t.share_slug) {
                const slug = makeSlug(t);
                await D.Travel.setShare(t.id, { slug, enabled: true });
                t.share_slug = slug;
                t.share_enabled = true;
            }
        } catch (err) {
            console.error('[travel] compartir:', err);
            return;
        }
        const url = `${location.origin}/travel/share?slug=${t.share_slug}`;
        $('tvs-url').value = url;
        $('tvs-enabled').checked = !!t.share_enabled;
        $('tvs-enabled-label').textContent = t.share_enabled ? 'Enlace activo' : 'Enlace desactivado';
        $('tvs-copy-label').textContent = 'Copiar';
        const msg = `Itinerario de mi viaje a ${t.city}: ${url}`;
        $('tvs-email').href = `mailto:?subject=${encodeURIComponent(`Itinerario · ${t.city}`)}&body=${encodeURIComponent(msg)}`;
        $('tvs-wa').href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
        openModal('tv-modal-share');
    }

    function wireShareModal() {
        $('tvs-copy').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText($('tvs-url').value);
                $('tvs-copy-label').textContent = 'Copiado';
                setTimeout(() => { $('tvs-copy-label').textContent = 'Copiar'; }, 2000);
            } catch (err) {
                $('tvs-url').select();
                document.execCommand('copy');
            }
        });
        $('tvs-enabled').addEventListener('change', async (e) => {
            const t = currentTrip;
            try {
                await D.Travel.setShare(t.id, { slug: t.share_slug, enabled: e.target.checked });
                t.share_enabled = e.target.checked;
                $('tvs-enabled-label').textContent = t.share_enabled ? 'Enlace activo' : 'Enlace desactivado';
            } catch (err) {
                console.error('[travel] toggle share:', err);
                e.target.checked = !e.target.checked;
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
            const btn = $('tvdoc-submit');
            btn.disabled = true;
            try {
                const safeName = file.name.replace(/[^\w.\-]+/g, '_');
                const path = `${session.user.id}/${t.id}/${Date.now()}_${safeName}`;
                const { error } = await _supabase.storage.from(BUCKET).upload(path, file);
                if (error) throw error;
                const category = $('tvdoc-cat').value;
                await D.Travel.addDocument({ tripId: t.id, category, fileName: file.name, storagePath: path });
                if (category === 'pasaje' && !(t.trip_events || []).some((ev) => ev.event_type === 'pasajes_agregados')) {
                    await D.Travel.addEvent({ tripId: t.id, eventType: 'pasajes_agregados' });
                    const item = (t.trip_checklist_items || []).find((c) => c.label === 'Pasajes comprados' && !c.is_done);
                    if (item) await D.Travel.setChecklistDone(item.id, true);
                }
                closeModal('tv-modal-doc');
                await refreshDetail();
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
