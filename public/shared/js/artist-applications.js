// ============================================
// Postulaciones del artista (DS Bauhaus) — /artist/applications
// Refs Figma: 105:4480 (Todas) · 132:15483 (Job Board) · 111:7694 (Spots) ·
// 133:16259 (detalle Job Board) · 132:15871 (detalle Spot).
// Unifica las propuestas enviadas a solicitudes del Job Board
// (job_board_applications vía WeotziData.JobBoard) y las postulaciones a spots
// de estudios (studio_spot_applications vía WeotziData.StudioSpots).
// Requiere sesión de artista; sin sesión se enruta a /artist/login.
// ============================================

(function () {
    'use strict';

    const PAGE_PATH = '/artist/applications';
    const LOGIN_URL = '/artist/login?returnTo=%2Fartist%2Fapplications';

    const KIND_LABELS = { resident: 'Residencia', itinerant: 'Itinerante', guest_spot: 'Guest spot' };

    const STATES = {
        esperando_respuesta: { label: 'Esperando respuesta', tag: 'wo-tag apx-tag--accent' },
        en_revision: { label: 'En revisión', tag: 'wo-tag wo-tag--soft' },
        contraoferta_recibida: { label: 'Contraoferta recibida', tag: 'wo-tag wo-tag--highlight' },
        confirmada: { label: 'Confirmada', tag: 'wo-tag wo-tag--active' },
        rechazada: { label: 'Rechazada', tag: 'wo-tag wo-tag--urgent' },
        expirada: { label: 'Expirada', tag: 'wo-tag wo-tag--archived' },
        retirada: { label: 'Retirada', tag: 'wo-tag wo-tag--archived' }
    };
    const CHIP_ORDER = ['esperando_respuesta', 'en_revision', 'contraoferta_recibida', 'confirmada', 'rechazada', 'expirada', 'retirada'];

    const MONTHS_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    const SIZE_LABELS = {
        small: 'Pequeño (menos de 10 cm)', pequeno: 'Pequeño (menos de 10 cm)',
        medium: 'Mediano (10–20 cm)', mediano: 'Mediano (10–20 cm)',
        large: 'Grande (20–40 cm)', grande: 'Grande (20–40 cm)',
        xlarge: 'Muy grande (40+ cm)'
    };

    let client = null;
    let session = null;
    let items = [];
    let loadError = null;
    let activeTab = 'todas';
    let activeChip = 'todas';
    let searchQuery = '';
    let searchTimer = null;

    document.addEventListener('DOMContentLoaded', boot);

    async function boot() {
        setupMobileMenu();
        client = await resolveClient();
        wireLogout();
        if (!client) {
            showLoadError('No pudimos conectar con el servidor. Recargá la página en unos segundos.');
            return;
        }
        try {
            const { data } = await client.auth.getSession();
            session = data && data.session ? data.session : null;
        } catch (err) {
            console.warn('[applications] no pudimos leer la sesión:', err);
            session = null;
        }
        if (!session) {
            window.location.href = LOGIN_URL;
            return;
        }

        wireListControls();
        await loadItems();
        window.addEventListener('popstate', () => route(false));
        route(false);
    }

    // ============================================
    // SESIÓN / TOPBAR
    // ============================================

    async function resolveClient() {
        const start = Date.now();
        while (Date.now() - start < 4000) {
            if (window.ConfigManager && typeof window.ConfigManager.getSupabaseClient === 'function') {
                const c = window.ConfigManager.getSupabaseClient();
                if (c) return c;
            }
            if (window._supabase) return window._supabase;
            await sleep(80);
        }
        // Último recurso: mismo fallback público que /studio-spots.
        try {
            const url = (window.CONFIG && window.CONFIG.supabase && window.CONFIG.supabase.url) || 'https://flbgmlvfiejfttlawnfu.supabase.co';
            const key = (window.CONFIG && window.CONFIG.supabase && window.CONFIG.supabase.anonKey) || '';
            if (window.supabase && url && key) {
                window._supabase = window.supabase.createClient(url, key);
                return window._supabase;
            }
        } catch (err) { console.warn('[applications] fallback client:', err); }
        return null;
    }

    function wireLogout() {
        const btn = document.getElementById('apx-logout');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            try { if (client) await client.auth.signOut(); } catch (err) { console.warn('[applications] logout:', err); }
            window.location.href = LOGIN_URL;
        });
    }

    function setupMobileMenu() {
        const toggle = document.getElementById('apx-mobile-menu-toggle');
        const menu = document.getElementById('apx-mobile-menu');
        if (!toggle || !menu) return;
        menu.hidden = true;
        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            const open = toggle.getAttribute('aria-expanded') !== 'true';
            menu.hidden = !open;
            toggle.setAttribute('aria-expanded', String(open));
        });
        document.addEventListener('click', (event) => {
            if (menu.hidden) return;
            if (menu.contains(event.target) || toggle.contains(event.target)) return;
            menu.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || menu.hidden) return;
            menu.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
        });
    }

    // ============================================
    // DATOS
    // ============================================

    async function loadItems() {
        const uid = session.user.id;
        loadError = null;
        let jbApps = [];
        let spotApps = [];
        try {
            const results = await Promise.allSettled([
                window.WeotziData.JobBoard.Applications.listForArtist(uid),
                window.WeotziData.StudioSpots.listApplicationsByArtist(uid)
            ]);
            if (results[0].status === 'fulfilled') jbApps = results[0].value || [];
            else console.error('[applications] job board:', results[0].reason);
            if (results[1].status === 'fulfilled') {
                const { data, error } = results[1].value || {};
                if (error) console.error('[applications] spots:', error);
                spotApps = data || [];
            } else {
                console.error('[applications] spots:', results[1].reason);
            }
            if (results[0].status === 'rejected' && results[1].status === 'rejected') {
                loadError = 'No pudimos cargar tus postulaciones. Recargá la página en unos segundos.';
            }
        } catch (err) {
            console.error('[applications] carga:', err);
            loadError = 'No pudimos cargar tus postulaciones. Recargá la página en unos segundos.';
        }

        // Contraofertas pendientes del cliente para las postulaciones vivas del JB.
        const offerMap = {};
        const open = jbApps.filter((a) => a.status === 'pending' || a.status === 'viewed');
        const offerResults = await Promise.allSettled(
            open.map((a) => window.WeotziData.JobBoard.CounterOffers.listByApplication(a.id))
        );
        offerResults.forEach((r, i) => {
            if (r.status === 'fulfilled') offerMap[open[i].id] = r.value || [];
        });

        items = []
            .concat(jbApps.map((app) => buildJbItem(app, offerMap[app.id] || [])))
            .concat(spotApps.map(buildSpotItem))
            .sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
    }

    function buildJbItem(app, offers) {
        const request = app.job_board_requests || null;
        const pendingClientOffer = offers.find((o) => o.author_role === 'client' && o.status === 'pendiente') || null;
        const currency = (request && request.client_budget_currency) || 'USD';
        return {
            kind: 'jobboard',
            id: app.id,
            app,
            request,
            pendingClientOffer,
            state: deriveJbState(app, request, !!pendingClientOffer),
            title: jbTitle(request, app),
            city: (request && request.client_city) || null,
            country: (request && request.client_country) || null,
            code: (request && request.request_code) || null,
            price: app.estimated_price,
            currency,
            sentAt: app.created_at,
            quoteId: (request && request.resulting_quote_id) || null,
            thumb: null
        };
    }

    function buildSpotItem(app) {
        const spot = app.studio_spots || null;
        const studio = (spot && spot.studios) || null;
        const loc = (spot && spot.location) || null;
        return {
            kind: 'spot',
            id: app.id,
            app,
            spot,
            studio,
            state: deriveSpotState(app, spot),
            title: (studio && studio.name) || (spot && spot.title) || 'Spot de estudio',
            kindLabel: spot ? (KIND_LABELS[spot.kind] || 'Spot') : 'Spot',
            city: (loc && loc.city) || null,
            country: (loc && loc.country) || null,
            split: spot && spot.revenue_split_pct != null ? Number(spot.revenue_split_pct) : null,
            sentAt: app.created_at,
            thumb: spotPhotos(spot, studio)[0] || null
        };
    }

    function deriveJbState(app, request, hasPendingClientOffer) {
        if (app.status === 'withdrawn') return 'retirada';
        if (app.status === 'rejected') return 'rechazada';
        if (app.status === 'accepted') return 'confirmada';
        if (hasPendingClientOffer) return 'contraoferta_recibida';
        if (request && request.status && request.status !== 'open') return 'expirada';
        if (app.status === 'viewed') return 'en_revision';
        return 'esperando_respuesta';
    }

    function deriveSpotState(app, spot) {
        if (app.status === 'withdrawn') return 'retirada';
        if (app.status === 'rejected') return 'rechazada';
        if (app.status === 'accepted') return 'confirmada';
        if (app.status === 'shortlisted') return 'en_revision';
        if (spot && spot.status && spot.status !== 'open') return 'expirada';
        return 'esperando_respuesta';
    }

    // Título derivado en render (sin columna nueva): descripción → estilo + zona → código.
    function jbTitle(request, app) {
        if (request) {
            const desc = (request.tattoo_idea_description || '').trim();
            if (desc) return truncate(desc, 80);
            const parts = [request.tattoo_style, request.tattoo_body_part].filter(Boolean);
            if (parts.length) return truncate(parts.join(' · '), 80);
            if (request.request_code) return 'Solicitud ' + request.request_code;
        }
        const msg = (app.message || '').trim();
        if (msg) return truncate(msg, 80);
        return 'Solicitud del job board';
    }

    function spotPhotos(spot, studio) {
        const feed = studio && Array.isArray(studio.photo_feed_items) ? studio.photo_feed_items : [];
        const urls = [
            spot && spot.cover_image,
            ...feed.map((p) => (p && typeof p === 'object' ? p.url : p)),
            studio && studio.cover_image,
            studio && studio.logo_image
        ].filter(Boolean);
        return urls.filter((u, i) => urls.indexOf(u) === i).slice(0, 4);
    }

    function findItem(kind, id) {
        return items.find((it) => it.kind === kind && String(it.id) === String(id)) || null;
    }

    // ============================================
    // RUTEO (listado ↔ detalle vía query string)
    // ============================================

    function route(push) {
        const params = new URLSearchParams(window.location.search);
        const type = params.get('type');
        const id = params.get('id');
        const from = params.get('from');
        const tab = normalizeTab(params.get('tab') || from);
        activeTab = tab;
        if ((type === 'jobboard' || type === 'spot') && id) {
            const item = findItem(type === 'jobboard' ? 'jobboard' : 'spot', id);
            if (item) {
                showDetail(item, false);
                return;
            }
        }
        showList(push === true);
    }

    function normalizeTab(v) {
        return v === 'jobboard' || v === 'spots' ? v : 'todas';
    }

    function listUrl(tab) {
        return tab && tab !== 'todas' ? PAGE_PATH + '?tab=' + tab : PAGE_PATH;
    }

    function detailUrl(item) {
        return PAGE_PATH + '?type=' + item.kind + '&id=' + encodeURIComponent(item.id) + '&from=' + activeTab;
    }

    function goToList(tab, push) {
        activeTab = normalizeTab(tab);
        activeChip = 'todas';
        if (push !== false) history.pushState({}, '', listUrl(activeTab));
        showList();
    }

    function goToDetail(item, push) {
        if (push !== false) history.pushState({}, '', detailUrl(item));
        showDetail(item);
    }

    function showList() {
        document.getElementById('apx-detail-view').hidden = true;
        document.getElementById('apx-list-view').hidden = false;
        renderList();
        window.scrollTo(0, 0);
    }

    function showDetail(item) {
        document.getElementById('apx-list-view').hidden = true;
        const view = document.getElementById('apx-detail-view');
        view.hidden = false;
        renderDetail(item);
        window.scrollTo(0, 0);
    }

    // ============================================
    // LISTADO
    // ============================================

    function wireListControls() {
        document.querySelectorAll('.apx-tabs .wo-tab').forEach((tabBtn) => {
            tabBtn.addEventListener('click', () => goToList(tabBtn.dataset.tab));
        });
        const search = document.getElementById('apx-search-input');
        if (search) {
            search.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    searchQuery = search.value.trim().toLowerCase();
                    renderList();
                }, 150);
            });
        }
        document.getElementById('apx-chips').addEventListener('click', (event) => {
            const chip = event.target.closest('.wo-chip');
            if (!chip || chip.disabled) return;
            activeChip = chip.dataset.chip;
            renderList();
        });
        document.getElementById('apx-rows').addEventListener('click', onRowAction);
    }

    function tabItemsOf(tab) {
        if (tab === 'jobboard') return items.filter((it) => it.kind === 'jobboard');
        if (tab === 'spots') return items.filter((it) => it.kind === 'spot');
        return items;
    }

    function renderList() {
        // Back link contextual del tab activo.
        const back = document.getElementById('apx-list-back');
        const backLabel = document.getElementById('apx-list-back-label');
        if (back && backLabel) {
            if (activeTab === 'spots') {
                back.href = '/studio-spots';
                backLabel.textContent = 'Volver a spots';
            } else {
                back.href = '/job-board';
                backLabel.textContent = 'Volver al job board';
            }
        }

        // Tabs + contadores.
        document.querySelectorAll('.apx-tabs .wo-tab').forEach((tabBtn) => {
            const isActive = tabBtn.dataset.tab === activeTab;
            tabBtn.classList.toggle('is-active', isActive);
            tabBtn.setAttribute('aria-selected', String(isActive));
        });
        document.querySelector('[data-count="todas"]').textContent = String(items.length);
        document.querySelector('[data-count="jobboard"]').textContent = String(tabItemsOf('jobboard').length);
        document.querySelector('[data-count="spots"]').textContent = String(tabItemsOf('spots').length);

        const tabItems = tabItemsOf(activeTab);

        // Chips de estado con contadores del tab activo.
        const counts = {};
        CHIP_ORDER.forEach((k) => { counts[k] = 0; });
        tabItems.forEach((it) => { counts[it.state] = (counts[it.state] || 0) + 1; });
        if (activeChip !== 'todas' && !counts[activeChip]) activeChip = 'todas';
        const chipsEl = document.getElementById('apx-chips');
        chipsEl.innerHTML = [
            chipHtml('todas', 'Todas', tabItems.length, activeChip === 'todas', tabItems.length === 0)
        ].concat(CHIP_ORDER.map((k) =>
            chipHtml(k, STATES[k].label, counts[k], activeChip === k, counts[k] === 0)
        )).join('');

        // Filtro por chip + búsqueda.
        let filtered = activeChip === 'todas' ? tabItems : tabItems.filter((it) => it.state === activeChip);
        if (searchQuery) {
            filtered = filtered.filter((it) => searchTextOf(it).includes(searchQuery));
        }

        const countEl = document.getElementById('apx-result-count');
        countEl.textContent = filtered.length + ' de ' + tabItems.length + ' ' +
            (tabItems.length === 1 ? 'postulación' : 'postulaciones');

        const rowsEl = document.getElementById('apx-rows');
        const emptyEl = document.getElementById('apx-empty');
        const errorEl = document.getElementById('apx-error');

        errorEl.hidden = !loadError;
        if (loadError) errorEl.textContent = loadError;

        if (!filtered.length) {
            rowsEl.innerHTML = '';
            emptyEl.hidden = false;
            emptyEl.innerHTML = tabItems.length === 0 ? emptyTabHtml() : emptyFilterHtml();
            return;
        }
        emptyEl.hidden = true;
        rowsEl.innerHTML = filtered.map(rowHtml).join('');
    }

    function chipHtml(key, label, count, isActive, isZero) {
        const dim = isZero && !isActive;
        return '<button type="button" class="wo-chip' + (isActive ? ' is-active' : '') + (dim ? ' is-dim' : '') + '"' +
            ' data-chip="' + key + '"' + (dim ? ' disabled' : '') +
            ' aria-pressed="' + isActive + '">' +
            escapeHtml(label) + ' (' + count + ')</button>';
    }

    function searchTextOf(it) {
        return [
            it.title, it.city, it.country, it.code,
            it.kind === 'spot' ? it.kindLabel : 'job board',
            it.studio && it.studio.name,
            STATES[it.state].label
        ].filter(Boolean).join(' ').toLowerCase();
    }

    function emptyTabHtml() {
        const jbCta = '<a href="/job-board" class="wo-btn wo-btn--s">Explorar el job board →</a>';
        const spotCta = '<a href="/studio-spots" class="wo-btn wo-btn--s wo-btn--secondary">Explorar spots →</a>';
        if (activeTab === 'jobboard') {
            return '<i data-wo-icon="briefcase" aria-hidden="true"></i>' +
                '<span class="wo-empty-title">Todavía no cotizaste ninguna solicitud</span>' +
                '<p>En el Job Board los clientes publican sus proyectos y vos les mandás tu propuesta.</p>' +
                '<div class="apx-empty-ctas">' + jbCta + '</div>';
        }
        if (activeTab === 'spots') {
            return '<i data-wo-icon="map-pin" aria-hidden="true"></i>' +
                '<span class="wo-empty-title">Todavía no te postulaste a ningún spot</span>' +
                '<p>Los estudios publican residencias y guest spots: encontrá tu próximo lugar donde tatuar.</p>' +
                '<div class="apx-empty-ctas"><a href="/studio-spots" class="wo-btn wo-btn--s">Explorar spots →</a></div>';
        }
        return '<i data-wo-icon="inbox" aria-hidden="true"></i>' +
            '<span class="wo-empty-title">Todavía no enviaste postulaciones</span>' +
            '<p>Cuando cotices una solicitud del Job Board o te postules a un spot, el seguimiento aparece acá.</p>' +
            '<div class="apx-empty-ctas">' + jbCta + spotCta + '</div>';
    }

    function emptyFilterHtml() {
        return '<i data-wo-icon="search" aria-hidden="true"></i>' +
            '<span class="wo-empty-title">Sin resultados</span>' +
            '<p>Probá con otra búsqueda u otro filtro de estado.</p>';
    }

    function rowHtml(it) {
        const st = STATES[it.state];
        const isSpot = it.kind === 'spot';
        const media = it.thumb
            ? '<img src="' + escapeAttr(it.thumb) + '" alt="" loading="lazy">'
            : '<i data-wo-icon="image" aria-hidden="true"></i>';
        const badges = '<span class="apx-typebadge ' + (isSpot ? 'apx-typebadge--spot' : 'apx-typebadge--jb') + '">' +
            (isSpot ? 'Spot' : 'Job board') + '</span>' +
            (isSpot && it.state === 'confirmada'
                ? '<span class="apx-confbadge"><i data-wo-icon="check-circle" aria-hidden="true"></i>Spot confirmado</span>'
                : '');
        const sub = isSpot
            ? '<i data-wo-icon="home" aria-hidden="true"></i>' + escapeHtml(it.kindLabel)
            : '<i data-wo-icon="user" aria-hidden="true"></i>Cliente' + (it.code ? ' · ' + escapeHtml(it.code) : '');
        const value = isSpot
            ? (it.split != null ? 'Split ' + it.split.toFixed(0) + '%' : 'A convenir')
            : (it.price != null ? fmtMoney(it.price, it.currency) : 'Sin precio');

        return '<article class="apx-row" data-kind="' + it.kind + '" data-id="' + escapeAttr(it.id) + '">' +
            '<div class="apx-row-media wo-media">' + media + '</div>' +
            '<div class="apx-row-main">' +
                '<div class="apx-row-badges">' + badges + '</div>' +
                '<h3 class="apx-row-title">' + escapeHtml(it.title) + '</h3>' +
                '<p class="apx-row-sub">' + sub + '</p>' +
            '</div>' +
            '<div class="apx-row-loc wo-meta"><i data-wo-icon="map-pin" aria-hidden="true"></i>' + escapeHtml(it.city || 'A confirmar') + '</div>' +
            '<div class="apx-row-value">' +
                '<span class="apx-row-price">' + escapeHtml(value) + '</span>' +
                '<span class="apx-row-date">' + fmtShortDate(it.sentAt) + '</span>' +
            '</div>' +
            '<div class="apx-row-state"><span class="' + st.tag + '">' + escapeHtml(st.label) + '</span></div>' +
            '<div class="apx-row-actions">' + rowActionsHtml(it) + '</div>' +
        '</article>';
    }

    function rowActionsHtml(it) {
        const actions = [];
        actions.push('<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-action="detail">' +
            (it.kind === 'spot' ? 'Ver oferta →' : 'Ver solicitud →') + '</button>');
        if (it.kind === 'jobboard' && it.quoteId) {
            actions.push('<a href="/artist/inbox" class="wo-btn wo-btn--secondary wo-btn--s">' +
                '<i data-wo-icon="message-circle" class="wo-icon-18" aria-hidden="true"></i>Ver conversación</a>');
        }
        if (it.state === 'contraoferta_recibida') {
            actions.push('<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-action="detail">' +
                '<i data-wo-icon="edit" class="wo-icon-18" aria-hidden="true"></i>Responder contraoferta</button>');
        } else if (it.state === 'confirmada') {
            actions.push('<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-action="conditions">' +
                '<i data-wo-icon="eye" class="wo-icon-18" aria-hidden="true"></i>Ver condiciones acordadas</button>');
        } else if (it.state === 'esperando_respuesta' || it.state === 'en_revision') {
            actions.push('<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-action="withdraw">' +
                '<i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i>Retirar</button>');
        }
        return actions.join('');
    }

    function onRowAction(event) {
        const btn = event.target.closest('[data-action]');
        if (!btn) return;
        const row = btn.closest('.apx-row');
        if (!row) return;
        const item = findItem(row.dataset.kind, row.dataset.id);
        if (!item) return;
        const action = btn.dataset.action;
        if (action === 'detail') goToDetail(item);
        else if (action === 'withdraw') openWithdrawModal(item);
        else if (action === 'conditions') openConditionsModal(item);
    }

    // ============================================
    // DETALLE
    // ============================================

    async function renderDetail(item) {
        const view = document.getElementById('apx-detail-view');
        view.innerHTML = '<div class="apx-skeleton-row"><span class="wo-skeleton apx-skel-media"></span><span class="wo-skeleton apx-skel-line"></span></div>';
        if (item.kind === 'jobboard') await renderJbDetail(item);
        else renderSpotDetail(item);
        if (window.WoIcons) window.WoIcons.hydrate(view);
    }

    // ---------- Detalle Job Board (ref 133:16259) ----------

    async function renderJbDetail(item) {
        const view = document.getElementById('apx-detail-view');
        let full = null;
        let offers = [];
        try {
            const results = await Promise.allSettled([
                window.WeotziData.JobBoard.Applications.getById(item.id),
                window.WeotziData.JobBoard.CounterOffers.listByApplication(item.id)
            ]);
            if (results[0].status === 'fulfilled') full = results[0].value;
            if (results[1].status === 'fulfilled') offers = results[1].value || [];
        } catch (err) {
            console.warn('[applications] detalle jb:', err);
        }

        const app = full || item.app;
        const request = (full && full.job_board_requests) || item.request;
        item.pendingClientOffer = offers.find((o) => o.author_role === 'client' && o.status === 'pendiente') || null;
        item.state = deriveJbState(app, request, !!item.pendingClientOffer);
        item.offers = offers;
        // El fetch de detalle puede traer la solicitud aunque el embed del listado
        // haya llegado null (RLS): refrescamos los derivados.
        if (request) {
            item.request = request;
            item.title = jbTitle(request, app);
            item.city = request.client_city || item.city;
            item.country = request.client_country || item.country;
            item.currency = request.client_budget_currency || item.currency;
            item.quoteId = request.resulting_quote_id || item.quoteId;
        }

        const st = STATES[item.state];
        const attachments = (request && request.job_board_attachments) || [];
        const refImage = attachments.length ? attachments[0].file_url : null;
        const styles = request ? String(request.tattoo_style || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
        const events = jbTimeline(item, app, offers);
        const lastMove = events.length ? events[events.length - 1].when : app.created_at;

        const mainHtml =
            '<div class="apx-detail-main">' +
            (request
                ? '<span class="apx-detail-loc"><i data-wo-icon="map-pin" aria-hidden="true"></i>' +
                    escapeHtml([request.client_city, request.client_country].filter(Boolean).join(', ') || 'Ubicación a confirmar') + '</span>' +
                  '<h1 class="wo-h1 apx-detail-title">' + escapeHtml(item.title) + '</h1>' +
                  '<div class="wo-media apx-refmedia">' +
                    (refImage
                        ? '<img src="' + escapeAttr(refImage) + '" alt="Referencia del cliente">'
                        : '<span class="apx-media-fallback"><i data-wo-icon="image" aria-hidden="true"></i>Referencia del cliente</span>') +
                  '</div>' +
                  (request.tattoo_idea_description
                      ? '<p class="apx-detail-desc">' + escapeHtml(request.tattoo_idea_description) + '</p>' : '') +
                  (styles.length
                      ? '<div class="apx-detail-tags">' + styles.map((s) => '<span class="wo-tag">' + escapeHtml(s) + '</span>').join('') + '</div>' : '') +
                  jbDatagridHtml(request)
                : '<h1 class="wo-h1 apx-detail-title">' + escapeHtml(item.title) + '</h1>' +
                  '<div class="wo-alert wo-alert--info">La solicitud original ya no está disponible. Te mostramos los datos de tu propuesta.</div>'
            ) +
            proposalHtml(item, app) +
            '<div class="apx-section-head"><h2 class="wo-h2">Conversación</h2></div>' +
            timelineHtml(events) +
            '</div>';

        view.innerHTML =
            backLinkHtml() +
            stepperHtml('jobboard', item) +
            terminalAlertHtml(item) +
            '<div class="apx-detail-grid">' + mainHtml + jbTrackHtml(item, app, request, lastMove) + '</div>';

        wireDetailActions(item);
    }

    function jbDatagridHtml(request) {
        const zone = [request.tattoo_body_part, request.tattoo_body_side].filter(Boolean).join(' · ');
        return '<div class="apx-datagrid">' +
            dataCell('Zona del cuerpo', zone || 'A definir') +
            dataCell('Tamaño estimado', sizeLabel(request.tattoo_size)) +
            dataCell('Presupuesto publicado', budgetRange(request.client_budget_min, request.client_budget_max, request.client_budget_currency), true) +
            dataCell('Fecha de publicación', fmtLongDate(request.created_at)) +
        '</div>';
    }

    function proposalHtml(item, app) {
        const isSpot = item.kind === 'spot';
        const portfolio = isSpot
            ? app.portfolio_url
            : (Array.isArray(app.portfolio_links) ? app.portfolio_links[0] : app.portfolio_links);
        const sentLabel = (isSpot ? 'Enviada' : 'Enviada');
        const when = fmtLongDate(app.created_at) + ' · ' + fmtTime(app.created_at);
        let grid = '';
        if (isSpot) {
            const range = parseRange(app.requested_dates);
            grid = '<div class="apx-track-row"><span class="wo-label">Fechas seleccionadas</span><strong>' +
                escapeHtml(range ? fmtRange(range.start, range.end) : 'A convenir con el estudio') + '</strong></div>';
        } else {
            grid = '<div class="apx-proposal-grid">' +
                '<div class="apx-proposal-cell"><span class="wo-label">Precio cotizado</span><span class="wo-mono-num">' +
                    escapeHtml(app.estimated_price != null ? fmtMoney(app.estimated_price, item.currency) : 'A definir') + '</span></div>' +
                '<div class="apx-proposal-cell"><span class="wo-label">Tiempo estimado</span><strong>' +
                    escapeHtml(sessionsLabel(app.estimated_sessions) || 'A definir') + '</strong></div>' +
            '</div>';
        }
        return '<div class="apx-section-head"><h2 class="wo-h2">' + (isSpot ? 'Mi solicitud' : 'Mi propuesta') + '</h2>' +
            '<span class="apx-sentbadge">' + sentLabel + '</span></div>' +
            '<div class="wo-card wo-card--flat apx-proposal">' +
                grid +
                (app.message
                    ? '<div class="apx-proposal-row"><span class="wo-label">' + (isSpot ? 'Mensaje de presentación' : 'Mensaje enviado al cliente') + '</span>' +
                      '<p class="apx-quote">"' + escapeHtml(app.message) + '"</p></div>'
                    : '') +
                (!isSpot && app.availability_note
                    ? '<div class="apx-proposal-row"><span class="wo-label">Disponibilidad</span>' +
                      '<p class="apx-quote">' + escapeHtml(app.availability_note) + '</p></div>'
                    : '') +
                '<div class="apx-proposal-foot">' +
                    (portfolio
                        ? '<a class="apx-attachment" href="' + escapeAttr(portfolio) + '" target="_blank" rel="noopener">' +
                          '<i data-wo-icon="file-text" aria-hidden="true"></i>' + escapeHtml(fileNameOf(portfolio)) + '</a>'
                        : '<span></span>') +
                    '<span class="apx-proposal-when">' + (isSpot ? 'Enviado' : 'Enviada') + ' el ' + escapeHtml(when) + '</span>' +
                '</div>' +
            '</div>';
    }

    function jbTrackHtml(item, app, request, lastMove) {
        const st = STATES[item.state];
        const rows =
            trackRow('Estado actual', '<span class="' + st.tag + '">' + escapeHtml(st.label) + '</span>') +
            trackRow('Último movimiento', '<strong>' + fmtShortDate(lastMove) + '</strong>') +
            trackRow('Desde el envío', '<strong>' + escapeHtml(daysSince(app.created_at)) + '</strong>') +
            trackRow('Cliente', '<strong>' + escapeHtml('Cliente' + (item.city ? ' · ' + item.city : '')) + '</strong>');

        const actions = [];
        if (item.pendingClientOffer) {
            const o = item.pendingClientOffer;
            actions.push(
                '<div class="apx-offerbox">' +
                    '<span class="apx-offerbox-title">El cliente propuso cambios</span>' +
                    '<div><span class="wo-label">Precio</span><br><strong class="wo-mono-num">' +
                        escapeHtml(o.price != null ? fmtMoney(o.price, o.currency || item.currency) : 'Sin cambios de precio') + '</strong></div>' +
                    '<div><span class="wo-label">Fecha propuesta</span><br><strong>' +
                        escapeHtml(o.proposed_date || 'Sin cambios de fecha propuestos') + '</strong></div>' +
                    (o.note ? '<div><span class="wo-label">Condiciones adicionales</span><p>' + escapeHtml(o.note) + '</p></div>' : '') +
                    '<button type="button" class="wo-btn wo-btn--direct wo-btn--block" data-action="respond">' +
                        'Responder contraoferta<i data-wo-icon="edit" class="wo-icon-18" aria-hidden="true"></i></button>' +
                '</div>'
            );
        }
        if (item.state === 'confirmada') {
            actions.push('<button type="button" class="wo-btn wo-btn--secondary wo-btn--block" data-action="conditions">' +
                '<i data-wo-icon="eye" class="wo-icon-18" aria-hidden="true"></i>Ver condiciones acordadas</button>');
            if (item.quoteId) {
                actions.push('<a href="/my-quotations" class="wo-btn wo-btn--direct wo-btn--block">Ver cotización →</a>');
            }
        }
        if (item.quoteId) {
            actions.push('<a href="/artist/inbox" class="wo-btn wo-btn--secondary wo-btn--block">' +
                '<i data-wo-icon="message-circle" class="wo-icon-18" aria-hidden="true"></i>Ver conversación</a>');
        }
        if (item.state === 'esperando_respuesta' || item.state === 'en_revision' || item.state === 'contraoferta_recibida') {
            actions.push('<button type="button" class="wo-btn wo-btn--ghost" data-action="withdraw">' +
                '<i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i>Retirar propuesta</button>');
        }

        return '<aside class="wo-card apx-track" aria-label="Seguimiento de la postulación">' +
            '<h3 class="wo-h3">Seguimiento</h3>' +
            '<hr class="apx-track-rule">' +
            '<div class="apx-track-rows">' + rows + '</div>' +
            '<div class="apx-track-actions">' + actions.join('') + '</div>' +
        '</aside>';
    }

    function jbTimeline(item, app, offers) {
        const ev = [];
        ev.push({
            type: 'sent',
            title: 'Propuesta enviada',
            detail: 'Cotizaste ' + (app.estimated_price != null ? fmtMoney(app.estimated_price, item.currency) : 'tu propuesta') +
                (app.estimated_sessions ? ' en ' + sessionsLabel(app.estimated_sessions) : '') + '.',
            when: app.created_at
        });
        offers.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach((o) => {
            ev.push({
                type: 'offer',
                title: o.author_role === 'client' ? 'El cliente propuso cambios' : 'Propusiste cambios',
                detail: offerSummary(o, item.currency),
                when: o.created_at
            });
            if (o.decided_at && (o.status === 'aceptada' || o.status === 'rechazada')) {
                ev.push({
                    type: o.status === 'aceptada' ? 'ok' : 'bad',
                    title: o.status === 'aceptada' ? 'Contraoferta aceptada' : 'Contraoferta rechazada',
                    detail: null,
                    when: o.decided_at
                });
            }
        });
        if (app.decided_at) {
            if (app.status === 'accepted') ev.push({ type: 'ok', title: 'Reserva confirmada', detail: 'El cliente aceptó tu propuesta.', when: app.decided_at });
            else if (app.status === 'rejected') ev.push({ type: 'bad', title: 'Propuesta rechazada', detail: null, when: app.decided_at });
            else if (app.status === 'withdrawn') ev.push({ type: 'status', title: 'Retiraste la propuesta', detail: null, when: app.decided_at });
        }
        return ev.sort((a, b) => new Date(a.when) - new Date(b.when));
    }

    function offerSummary(o, currency) {
        const parts = [];
        if (o.price != null) parts.push('Nuevo precio: ' + fmtMoney(o.price, o.currency || currency) + '.');
        if (o.proposed_date) parts.push('Fecha propuesta: ' + o.proposed_date + '.');
        if (o.note) parts.push(o.note);
        return parts.join(' ') || null;
    }

    // ---------- Detalle Spot (ref 132:15871) ----------

    function renderSpotDetail(item) {
        const view = document.getElementById('apx-detail-view');
        const app = item.app;
        const spot = item.spot;
        const studio = item.studio;
        const events = spotTimeline(item, app);
        const lastMove = events.length ? events[events.length - 1].when : app.created_at;
        const photos = spotPhotos(spot, studio);

        let mainHtml = '<div class="apx-detail-main">';
        if (spot) {
            const offerTags =
                '<span class="wo-tag apx-tag--accent">' + escapeHtml(item.kindLabel) + '</span>' +
                (spot.includes_housing ? '<span class="wo-tag">Alojamiento incluido</span>' : '');
            const includes = [];
            if (spot.includes_housing) includes.push('Alojamiento incluido durante el spot');
            if (spot.stipend_amount) includes.push('Stipend de ' + fmtMoney(spot.stipend_amount, spot.stipend_currency || 'USD'));
            if (spot.revenue_split_pct != null) includes.push('Split del ' + Number(spot.revenue_split_pct).toFixed(0) + '% para el artista');

            mainHtml +=
                '<span class="apx-detail-loc"><i data-wo-icon="map-pin" aria-hidden="true"></i>' +
                    escapeHtml([item.city, item.country].filter(Boolean).join(', ') || 'Ubicación a confirmar') + '</span>' +
                '<h1 class="wo-h1 apx-detail-title">' + escapeHtml(item.title) + '</h1>' +
                (photos.length
                    ? '<div class="apx-gallery">' + photos.map((u) =>
                        '<div class="wo-media"><img src="' + escapeAttr(u) + '" alt="Foto del estudio" loading="lazy"></div>').join('') + '</div>'
                    : '<div class="wo-media apx-refmedia"><span class="apx-media-fallback"><i data-wo-icon="image" aria-hidden="true"></i>Fotos del estudio</span></div>') +
                (spot.description ? '<p class="apx-detail-desc">' + escapeHtml(spot.description) + '</p>' : '') +
                '<div class="apx-detail-tags">' + offerTags + '</div>' +
                '<div class="apx-datagrid">' +
                    dataCell('Fechas', spot.start_date ? fmtRange(new Date(spot.start_date), new Date(spot.end_date || spot.start_date)) : 'A convenir') +
                    dataCell('Duración', spotDuration(spot)) +
                    dataCell('Split', spot.revenue_split_pct != null ? Number(spot.revenue_split_pct).toFixed(0) + '% para el artista' : 'A convenir') +
                    dataCell('Stipend', spot.stipend_amount ? fmtMoney(spot.stipend_amount, spot.stipend_currency || 'USD') : 'Sin stipend', spot.stipend_amount != null) +
                '</div>' +
                (includes.length
                    ? '<div class="apx-twolists"><div class="apx-bullets"><span class="wo-label">Qué incluye el estudio</span><ul>' +
                        includes.map((t) => '<li>' + escapeHtml(t) + '</li>').join('') + '</ul></div></div>'
                    : '');
        } else {
            mainHtml +=
                '<h1 class="wo-h1 apx-detail-title">' + escapeHtml(item.title) + '</h1>' +
                '<div class="wo-alert wo-alert--info">La oferta del estudio ya no está disponible. Te mostramos los datos de tu solicitud.</div>';
        }
        mainHtml +=
            proposalHtml(item, app) +
            '<div class="apx-section-head"><h2 class="wo-h2">Conversación</h2></div>' +
            timelineHtml(events) +
            '</div>';

        view.innerHTML =
            backLinkHtml() +
            stepperHtml('spot', item) +
            terminalAlertHtml(item) +
            '<div class="apx-detail-grid">' + mainHtml + spotTrackHtml(item, lastMove) + '</div>';

        wireDetailActions(item);
        if (window.WoIcons) window.WoIcons.hydrate(view);
    }

    function spotDuration(spot) {
        if (spot.weeks_minimum) {
            return spot.weeks_maximum && spot.weeks_maximum !== spot.weeks_minimum
                ? spot.weeks_minimum + ' a ' + spot.weeks_maximum + ' semanas'
                : spot.weeks_minimum + ' semana' + (spot.weeks_minimum === 1 ? '' : 's');
        }
        if (spot.start_date && spot.end_date) {
            const days = Math.round((new Date(spot.end_date) - new Date(spot.start_date)) / 86400000);
            if (days >= 55) return Math.round(days / 30) + ' meses';
            if (days >= 7) return Math.round(days / 7) + ' semanas';
            return days + ' días';
        }
        return 'A convenir';
    }

    function spotTrackHtml(item, lastMove) {
        const st = STATES[item.state];
        const rows =
            trackRow('Estado actual', '<span class="' + st.tag + '">' + escapeHtml(st.label) + '</span>') +
            trackRow('Último movimiento', '<strong>' + fmtShortDate(lastMove) + '</strong>') +
            trackRow('Desde el envío', '<strong>' + escapeHtml(daysSince(item.app.created_at)) + '</strong>') +
            trackRow('Estudio', '<strong>' + escapeHtml((item.studio && item.studio.name) || 'Estudio') + '</strong>') +
            trackRow('Tipo de spot', '<strong>' + escapeHtml(item.kindLabel) + '</strong>');

        const actions = [];
        if (item.state === 'confirmada') {
            actions.push('<button type="button" class="wo-btn wo-btn--secondary wo-btn--block" data-action="conditions">' +
                '<i data-wo-icon="eye" class="wo-icon-18" aria-hidden="true"></i>Ver condiciones acordadas</button>');
        }
        if (item.state === 'esperando_respuesta' || item.state === 'en_revision') {
            actions.push('<button type="button" class="wo-btn wo-btn--ghost" data-action="withdraw">' +
                '<i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i>Retirar postulación</button>');
        }

        return '<aside class="wo-card apx-track" aria-label="Seguimiento de la postulación">' +
            '<h3 class="wo-h3">Seguimiento</h3>' +
            '<hr class="apx-track-rule">' +
            '<div class="apx-track-rows">' + rows + '</div>' +
            '<div class="apx-track-actions">' + actions.join('') + '</div>' +
        '</aside>';
    }

    function spotTimeline(item, app) {
        const ev = [];
        const range = parseRange(app.requested_dates);
        ev.push({
            type: 'sent',
            title: 'Solicitud enviada',
            detail: range
                ? 'Elegiste ' + fmtRange(range.start, range.end) + ' como fechas propuestas.'
                : 'Fechas a convenir con el estudio.',
            when: app.created_at
        });
        if (app.status === 'shortlisted') {
            ev.push({ type: 'status', title: 'Cambio de estado: en revisión', detail: 'El estudio dejó tu solicitud en la lista corta.', when: app.decided_at || app.created_at });
        }
        if (app.decided_at) {
            if (app.status === 'accepted') ev.push({ type: 'ok', title: 'Spot confirmado', detail: 'El estudio aceptó tu solicitud.', when: app.decided_at });
            else if (app.status === 'rejected') ev.push({ type: 'bad', title: 'Solicitud rechazada', detail: null, when: app.decided_at });
            else if (app.status === 'withdrawn') ev.push({ type: 'status', title: 'Retiraste la postulación', detail: null, when: app.decided_at });
        }
        return ev.sort((a, b) => new Date(a.when) - new Date(b.when));
    }

    // ---------- Piezas compartidas del detalle ----------

    function backLinkHtml() {
        return '<a class="apx-back" href="' + listUrl(activeTab) + '" data-action="back">' +
            '<i data-wo-icon="arrow-left" class="wo-icon-18" aria-hidden="true"></i>Volver a mis postulaciones</a>';
    }

    function stepperHtml(kind, item) {
        const labels = kind === 'spot'
            ? ['Solicitud enviada', 'En revisión', 'Contraoferta', 'Confirmada']
            : ['Propuesta enviada', 'Cliente revisando', 'Negociación', 'Reserva confirmada'];
        let done = 1;
        let active = 0;
        if (item.state === 'en_revision') { done = 1; active = 2; }
        else if (item.state === 'contraoferta_recibida') { done = 2; active = 3; }
        else if (item.state === 'confirmada') { done = 4; active = 0; }
        const parts = [];
        labels.forEach((label, i) => {
            const n = i + 1;
            const cls = n <= done ? ' is-done' : (n === active ? ' is-active' : '');
            const box = n <= done
                ? '<i data-wo-icon="check" class="wo-icon-18" aria-hidden="true"></i>'
                : String(n);
            parts.push('<div class="apx-step' + cls + '"><span class="apx-step-box">' + box + '</span>' +
                '<span class="apx-step-label">' + escapeHtml(label) + '</span></div>');
            if (n < labels.length) {
                parts.push('<span class="apx-step-line' + (n < done ? ' is-done' : '') + '"></span>');
            }
        });
        return '<div class="apx-stepper" aria-label="Progreso de la postulación">' + parts.join('') + '</div>';
    }

    function terminalAlertHtml(item) {
        if (item.state === 'rechazada') {
            return '<div class="wo-alert wo-alert--error apx-detail-alert">' +
                (item.kind === 'spot' ? 'El estudio eligió otra propuesta para este spot.' : 'El cliente eligió otra propuesta para este proyecto.') + '</div>';
        }
        if (item.state === 'expirada') {
            return '<div class="wo-alert wo-alert--warning apx-detail-alert">' +
                (item.kind === 'spot' ? 'El spot ya no está abierto. Tu postulación quedó archivada.' : 'La solicitud ya no está abierta. Tu propuesta quedó archivada.') + '</div>';
        }
        if (item.state === 'retirada') {
            return '<div class="wo-alert wo-alert--info apx-detail-alert">' +
                (item.kind === 'spot' ? 'Retiraste esta postulación.' : 'Retiraste esta propuesta.') + '</div>';
        }
        return '';
    }

    function timelineHtml(events) {
        if (!events.length) return '';
        return '<ol class="apx-timeline">' + events.map((e) => {
            const mod = e.type === 'offer' ? ' apx-tl--offer'
                : e.type === 'status' ? ' apx-tl--status'
                : e.type === 'ok' ? ' apx-tl--ok'
                : e.type === 'bad' ? ' apx-tl--bad' : '';
            return '<li class="apx-tl' + mod + '"><span class="apx-tl-dot" aria-hidden="true"></span>' +
                '<div class="apx-tl-body">' +
                    '<span class="apx-tl-title">' + escapeHtml(e.title) + '</span>' +
                    (e.detail ? '<p class="apx-tl-detail">' + escapeHtml(e.detail) + '</p>' : '') +
                    '<span class="apx-tl-when">' + fmtDateTime(e.when) + '</span>' +
                '</div></li>';
        }).join('') + '</ol>';
    }

    function dataCell(label, value, mono) {
        return '<div class="apx-datacell"><span class="wo-label">' + escapeHtml(label) + '</span>' +
            '<strong' + (mono ? ' class="wo-mono-num"' : '') + '>' + escapeHtml(value) + '</strong></div>';
    }

    function trackRow(label, valueHtml) {
        return '<div class="apx-track-row"><span class="wo-label">' + escapeHtml(label) + '</span>' + valueHtml + '</div>';
    }

    function wireDetailActions(item) {
        const view = document.getElementById('apx-detail-view');
        view.querySelectorAll('[data-action]').forEach((el) => {
            const action = el.dataset.action;
            if (action === 'back') {
                el.addEventListener('click', (event) => {
                    event.preventDefault();
                    goToList(activeTab);
                });
            } else if (action === 'withdraw') {
                el.addEventListener('click', () => openWithdrawModal(item, true));
            } else if (action === 'respond') {
                el.addEventListener('click', () => openRespondModal(item));
            } else if (action === 'conditions') {
                el.addEventListener('click', () => openConditionsModal(item));
            }
        });
    }

    // ============================================
    // MODALES
    // ============================================

    function openModal(html) {
        const root = document.getElementById('apx-modal-root');
        root.innerHTML = '<div class="wo-overlay" id="apx-overlay"><div class="wo-modal" role="dialog" aria-modal="true">' + html + '</div></div>';
        const overlay = document.getElementById('apx-overlay');
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeModal();
        });
        document.addEventListener('keydown', onModalEscape);
        if (window.WoIcons) window.WoIcons.hydrate(root);
        return overlay;
    }

    function onModalEscape(event) {
        if (event.key === 'Escape') closeModal();
    }

    function closeModal() {
        document.removeEventListener('keydown', onModalEscape);
        document.getElementById('apx-modal-root').innerHTML = '';
    }

    function modalError(overlay, message) {
        let el = overlay.querySelector('.apx-modal-error');
        if (!el) {
            el = document.createElement('div');
            el.className = 'wo-alert wo-alert--error apx-modal-error';
            overlay.querySelector('.wo-modal').appendChild(el);
        }
        el.textContent = message;
    }

    // ---------- Retirar ----------

    function openWithdrawModal(item, fromDetail) {
        const isSpot = item.kind === 'spot';
        const overlay = openModal(
            '<h3 class="wo-modal-title">' + (isSpot ? 'Retirar postulación' : 'Retirar propuesta') + '</h3>' +
            '<p>' + (isSpot
                ? 'El estudio deja de ver tu solicitud para este spot. Esta acción no se puede deshacer.'
                : 'El cliente deja de ver tu propuesta para este proyecto. Esta acción no se puede deshacer.') + '</p>' +
            '<div class="wo-modal-actions">' +
                '<button type="button" class="wo-btn wo-btn--ghost" data-modal="cancel">Cancelar</button>' +
                '<button type="button" class="wo-btn wo-btn--danger" data-modal="confirm">Retirar</button>' +
            '</div>'
        );
        overlay.querySelector('[data-modal="cancel"]').addEventListener('click', closeModal);
        overlay.querySelector('[data-modal="confirm"]').addEventListener('click', async (event) => {
            const btn = event.currentTarget;
            btn.disabled = true;
            try {
                if (isSpot) {
                    const { error } = await window.WeotziData.StudioSpots.withdrawApplication(item.id);
                    if (error) throw error;
                } else {
                    await window.WeotziData.JobBoard.Applications.withdraw(item.id);
                }
                item.app.status = 'withdrawn';
                item.app.decided_at = new Date().toISOString();
                item.pendingClientOffer = null;
                item.state = 'retirada';
                closeModal();
                refreshCurrentView(item, fromDetail);
            } catch (err) {
                console.error('[applications] retirar:', err);
                btn.disabled = false;
                modalError(overlay, 'No pudimos retirar la postulación. Probá de nuevo en unos segundos.');
            }
        });
    }

    // ---------- Responder contraoferta (solo Job Board) ----------

    function openRespondModal(item) {
        const o = item.pendingClientOffer;
        if (!o) return;
        const overlay = openModal(
            '<h3 class="wo-modal-title">Responder contraoferta</h3>' +
            '<div class="apx-modal-summary">' +
                trackRow('Precio propuesto', '<strong class="wo-mono-num">' + escapeHtml(o.price != null ? fmtMoney(o.price, o.currency || item.currency) : 'Sin cambios de precio') + '</strong>') +
                trackRow('Fecha propuesta', '<strong>' + escapeHtml(o.proposed_date || 'Sin cambios de fecha propuestos') + '</strong>') +
                (o.note ? trackRow('Condiciones', '<strong>' + escapeHtml(o.note) + '</strong>') : '') +
            '</div>' +
            '<div class="apx-modal-quick">' +
                '<button type="button" class="wo-btn wo-btn--direct" data-modal="accept">Aceptar contraoferta</button>' +
                '<button type="button" class="wo-btn wo-btn--secondary" data-modal="reject">Rechazar</button>' +
            '</div>' +
            '<p class="apx-modal-sep">O contra-proponé otras condiciones</p>' +
            '<form class="apx-modal-form" data-modal="counter-form">' +
                '<div class="wo-field"><label class="wo-label" for="apx-co-price">Precio</label>' +
                    '<input type="number" min="1" step="1" id="apx-co-price" class="wo-input" placeholder="450"></div>' +
                '<div class="wo-field"><label class="wo-label" for="apx-co-date">Fecha propuesta</label>' +
                    '<input type="text" id="apx-co-date" class="wo-input" placeholder="Por ejemplo: semana del 10 de agosto"></div>' +
                '<div class="wo-field"><label class="wo-label" for="apx-co-note">Nota para el cliente</label>' +
                    '<textarea id="apx-co-note" class="wo-textarea" rows="3" placeholder="Contale qué mantenés y qué cambia"></textarea></div>' +
                '<div class="wo-modal-actions">' +
                    '<button type="button" class="wo-btn wo-btn--ghost" data-modal="cancel">Cancelar</button>' +
                    '<button type="submit" class="wo-btn">Enviar contrapropuesta</button>' +
                '</div>' +
            '</form>'
        );

        overlay.querySelector('[data-modal="cancel"]').addEventListener('click', closeModal);

        const decide = async (status, btn) => {
            btn.disabled = true;
            try {
                await window.WeotziData.JobBoard.CounterOffers.decide(o.id, status);
                o.status = status;
                o.decided_at = new Date().toISOString();
                item.pendingClientOffer = null;
                item.state = deriveJbState(item.app, item.request, false);
                closeModal();
                refreshCurrentView(item, true);
            } catch (err) {
                console.error('[applications] contraoferta:', err);
                btn.disabled = false;
                modalError(overlay, 'No pudimos registrar tu respuesta. Probá de nuevo en unos segundos.');
            }
        };
        overlay.querySelector('[data-modal="accept"]').addEventListener('click', (e) => decide('aceptada', e.currentTarget));
        overlay.querySelector('[data-modal="reject"]').addEventListener('click', (e) => decide('rechazada', e.currentTarget));

        overlay.querySelector('[data-modal="counter-form"]').addEventListener('submit', async (event) => {
            event.preventDefault();
            const priceRaw = overlay.querySelector('#apx-co-price').value;
            const price = priceRaw ? parseFloat(priceRaw) : null;
            const proposedDate = overlay.querySelector('#apx-co-date').value.trim() || null;
            const note = overlay.querySelector('#apx-co-note').value.trim() || null;
            if (price == null && !proposedDate && !note) {
                modalError(overlay, 'Cargá al menos un cambio: precio, fecha o nota.');
                return;
            }
            const submitBtn = overlay.querySelector('[type="submit"]');
            submitBtn.disabled = true;
            try {
                await window.WeotziData.JobBoard.CounterOffers.create({
                    applicationId: item.id,
                    authorRole: 'artist',
                    price,
                    currency: item.currency,
                    proposedDate,
                    note
                });
                item.pendingClientOffer = null;
                item.state = deriveJbState(item.app, item.request, false);
                closeModal();
                refreshCurrentView(item, true);
            } catch (err) {
                console.error('[applications] contrapropuesta:', err);
                submitBtn.disabled = false;
                modalError(overlay, 'No pudimos enviar la contrapropuesta. Probá de nuevo en unos segundos.');
            }
        });
    }

    // ---------- Condiciones acordadas ----------

    async function openConditionsModal(item) {
        let rows = '';
        let footer = '';
        if (item.kind === 'jobboard') {
            let offers = item.offers;
            if (!offers) {
                try { offers = await window.WeotziData.JobBoard.CounterOffers.listByApplication(item.id); }
                catch (err) { offers = []; }
                item.offers = offers;
            }
            const accepted = (offers || []).filter((o) => o.status === 'aceptada')
                .sort((a, b) => new Date(b.decided_at || b.created_at) - new Date(a.decided_at || a.created_at))[0] || null;
            const finalPrice = accepted && accepted.price != null ? accepted.price : item.app.estimated_price;
            rows =
                trackRow('Precio final', '<strong class="wo-mono-num">' + escapeHtml(finalPrice != null ? fmtMoney(finalPrice, item.currency) : 'A definir con el cliente') + '</strong>') +
                trackRow('Fecha', '<strong>' + escapeHtml((accepted && accepted.proposed_date) || 'A coordinar con el cliente') + '</strong>') +
                (accepted && accepted.note ? trackRow('Condiciones', '<strong>' + escapeHtml(accepted.note) + '</strong>') : '') +
                (item.app.estimated_sessions ? trackRow('Sesiones', '<strong>' + escapeHtml(sessionsLabel(item.app.estimated_sessions)) + '</strong>') : '');
            if (item.quoteId) {
                footer = '<a href="/my-quotations" class="wo-btn wo-btn--direct wo-btn--block">Ver cotización →</a>';
            }
        } else {
            const spot = item.spot;
            const range = parseRange(item.app.requested_dates);
            rows =
                trackRow('Estudio', '<strong>' + escapeHtml((item.studio && item.studio.name) || 'Estudio') + '</strong>') +
                trackRow('Tipo de spot', '<strong>' + escapeHtml(item.kindLabel) + '</strong>') +
                trackRow('Fechas', '<strong>' + escapeHtml(range
                    ? fmtRange(range.start, range.end)
                    : (spot && spot.start_date ? fmtRange(new Date(spot.start_date), new Date(spot.end_date || spot.start_date)) : 'A convenir con el estudio')) + '</strong>') +
                (spot && spot.revenue_split_pct != null ? trackRow('Split', '<strong>' + Number(spot.revenue_split_pct).toFixed(0) + '% para el artista</strong>') : '') +
                (spot && spot.stipend_amount ? trackRow('Stipend', '<strong class="wo-mono-num">' + escapeHtml(fmtMoney(spot.stipend_amount, spot.stipend_currency || 'USD')) + '</strong>') : '');
        }

        const overlay = openModal(
            '<h3 class="wo-modal-title">Condiciones acordadas</h3>' +
            '<div class="apx-modal-summary">' + rows + '</div>' +
            (footer || '') +
            '<div class="wo-modal-actions">' +
                '<button type="button" class="wo-btn wo-btn--secondary" data-modal="close">Cerrar</button>' +
            '</div>'
        );
        overlay.querySelector('[data-modal="close"]').addEventListener('click', closeModal);
    }

    function refreshCurrentView(item, fromDetail) {
        if (fromDetail && !document.getElementById('apx-detail-view').hidden) {
            renderDetail(item);
        } else {
            renderList();
        }
    }

    // ============================================
    // FORMATO
    // ============================================

    function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(v) { return escapeHtml(v); }

    function truncate(str, max) {
        const s = String(str);
        return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
    }

    function fileNameOf(url) {
        try {
            const clean = String(url).split('?')[0].split('#')[0];
            const last = clean.split('/').filter(Boolean).pop();
            return last || url;
        } catch (err) { return url; }
    }

    function toDate(v) {
        if (!v) return null;
        const d = v instanceof Date ? v : new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }

    function fmtShortDate(v) {
        const d = toDate(v);
        if (!d) return '—';
        return d.getDate() + ' ' + MONTHS_ABBR[d.getMonth()] + ' ' + d.getFullYear();
    }

    function fmtLongDate(v) {
        const d = toDate(v);
        if (!d) return '—';
        return d.getDate() + ' de ' + MONTHS_LONG[d.getMonth()] + ', ' + d.getFullYear();
    }

    function fmtTime(v) {
        const d = toDate(v);
        if (!d) return '';
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function fmtDateTime(v) {
        const d = toDate(v);
        if (!d) return '—';
        return fmtShortDate(d) + ', ' + fmtTime(d);
    }

    // Números europeos (regla dura 10): 4.820 · $3.150.
    function fmtNum(n) {
        return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(n));
    }

    function fmtMoney(n, currency) {
        if (n == null || isNaN(Number(n))) return '—';
        const cur = String(currency || 'USD').toUpperCase();
        if (cur === 'USD' || cur === '$') return '$' + fmtNum(n);
        return fmtNum(n) + ' ' + cur;
    }

    function budgetRange(min, max, currency) {
        if (min != null && max != null) return fmtMoney(min, currency) + ' – ' + fmtMoney(max, currency);
        if (min != null) return 'Desde ' + fmtMoney(min, currency);
        if (max != null) return 'Hasta ' + fmtMoney(max, currency);
        return 'A convenir';
    }

    function sessionsLabel(n) {
        if (!n) return null;
        const v = parseInt(n, 10);
        if (isNaN(v) || v < 1) return null;
        return v === 1 ? '1 sesión' : v + ' sesiones';
    }

    function daysSince(v) {
        const d = toDate(v);
        if (!d) return '—';
        const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
        if (days === 0) return 'Hoy';
        return days === 1 ? '1 día' : days + ' días';
    }

    function sizeLabel(raw) {
        if (!raw) return 'A definir';
        const key = String(raw).toLowerCase().replace(/\s+/g, '_');
        for (const k of Object.keys(SIZE_LABELS)) {
            if (key.includes(k)) return SIZE_LABELS[k];
        }
        const clean = String(raw).replace(/_/g, ' ');
        return clean.charAt(0).toUpperCase() + clean.slice(1);
    }

    // Literal DATERANGE de Postgres '[inicio,fin)' → fechas inclusivas.
    function parseRange(raw) {
        if (!raw || typeof raw !== 'string') return null;
        const m = raw.match(/^[\[\(]\s*(\d{4}-\d{2}-\d{2})\s*,\s*(\d{4}-\d{2}-\d{2})\s*([\)\]])$/);
        if (!m) return null;
        const start = new Date(m[1] + 'T00:00:00');
        let end = new Date(m[2] + 'T00:00:00');
        if (m[3] === ')') end = new Date(end.getTime() - 86400000);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
        return { start, end };
    }

    function fmtRange(start, end) {
        const s = toDate(start);
        const e = toDate(end);
        if (!s) return '—';
        if (!e || s.getTime() === e.getTime()) return fmtLongDate(s);
        if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
            return s.getDate() + ' – ' + e.getDate() + ' de ' + MONTHS_LONG[e.getMonth()] + ', ' + e.getFullYear();
        }
        if (s.getFullYear() === e.getFullYear()) {
            return s.getDate() + ' ' + MONTHS_ABBR[s.getMonth()] + ' – ' + e.getDate() + ' ' + MONTHS_ABBR[e.getMonth()] + ' ' + e.getFullYear();
        }
        return fmtShortDate(s) + ' – ' + fmtShortDate(e);
    }

    function showLoadError(message) {
        const rowsEl = document.getElementById('apx-rows');
        const errorEl = document.getElementById('apx-error');
        if (rowsEl) rowsEl.innerHTML = '';
        if (errorEl) {
            errorEl.hidden = false;
            errorEl.textContent = message;
        }
    }
})();
