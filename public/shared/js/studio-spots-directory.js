// ============================================
// Spots del artista (DS Bauhaus) — refs Figma 05 · 06 · 07
// 05: franja destacada de ancho completo + mosaico editorial sobre ink + cinta
//     de spots que cierran.
// 06: detalle del spot como PÁGINA (main + aside con calendario de fechas,
//     mensaje de presentación y portfolio).
// 07: pantalla de confirmación "Solicitud enviada".
// Datos: studio_spots (status='open') vía WeotziData.StudioSpots.
// Postular exige sesión de artista; si no, se enruta a /artist/login.
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;

    const KIND_LABELS = { resident: 'Residencia', itinerant: 'Itinerante', guest_spot: 'Guest spot' };
    // Modalidad de pago del spot (plataforma de estudios, M2): mismas etiquetas
    // que WeOtziStudioKit.LABELS (compensationModel / fixedPeriod / fixedPayer).
    const COMPENSATION_LABELS = { percentage: 'Porcentaje', fixed: 'Pago fijo', mixed: 'Mixto' };
    const FIXED_PERIOD_SUFFIX = { per_session: 'por sesión', daily: 'por día', weekly: 'por semana', monthly: 'por mes', one_time: 'pago único' };
    const FIXED_PAYER_LABELS = {
        artist_to_studio: 'Alquiler de puesto: el artista paga al estudio',
        studio_to_artist: 'Pago al artista: el estudio paga'
    };
    const FIXED_PAYER_SHORT = { artist_to_studio: 'Alquiler', studio_to_artist: 'Pago al artista' };
    // Columnas de M2 que el select del directorio puede no traer.
    const SPOT_TERM_KEYS = ['benefit_tags', 'compensation_model', 'fixed_amount', 'fixed_currency', 'fixed_period', 'fixed_payer'];
    const termsLoaded = new WeakSet();
    const RIBBON_SLOTS = 4;
    const MOSAIC_SLOTS = 9;
    const MOBILE_MENU_BREAKPOINT = 768;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const FIGMA_SPOT_FALLBACK_IMAGES = {
        'bang-bang-nyc': '/shared/assets/figma/opportunities/spots-studio-01.png'
    };
    const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    let spots = [];
    // Directorio completo (sin filtrar) y estado de la barra de exploración (Figma 801:537).
    let allSpots = [];
    const filters = { q: '', country: '', city: '', date: '', kind: '', housing: false, stipend: false, mystyles: false };
    let sortMode = 'relevance';
    let searchTimer = null;
    let currentSpot = null;
    let session = null;
    let artist = null;
    // Estado del calendario del aside (ref 06).
    let calCursor = null;
    let selStart = null;
    let selEnd = null;

    document.addEventListener('DOMContentLoaded', async () => {
        setupMobileMenu();
        await resolveViewer();
        wireLogout();
        wireExploreControls();
        loadInvitationsCount();
        window.addEventListener('popstate', () => openFromQuery({ push: false }));
        await loadSpots();
    });

    // ============================================
    // SESIÓN / TOPBAR
    // ============================================

    async function resolveViewer() {
        try {
            const { data } = await _supabase.auth.getSession();
            session = data?.session || null;
        } catch (err) {
            console.warn('[spots] no pudimos leer la sesión:', err);
            session = null;
        }

        if (session) {
            const { data: row } = await WeotziData.Artists.getByUserId(
                session.user.id,
                'user_id, username, name, city, ubicacion, styles_array, profile_picture, gallery_images, portafolio'
            );
            artist = row || null;
            if (artist) loadArtistStats();
        }
        paintTopbarAuth();
    }

    // "4,9 · 32 trabajos" (con estrella Feather) de la tarjeta de portfolio (Figma 801:538).
    let artistStats = { rating: null, works: null };
    async function loadArtistStats() {
        try {
            const [ratingResult, workResult] = await Promise.all([
                WeotziData.from('public_review_summary')
                    .select('average_rating, review_count')
                    .eq('reviewee_type', 'artist')
                    .eq('reviewee_user_id', artist.user_id)
                    .maybeSingle(),
                WeotziData.from('quotations_db')
                    .select('*', { count: 'exact', head: true })
                    .eq('artist_id', artist.user_id)
                    .eq('quote_status', 'completed')
            ]);
            artistStats = {
                rating: ratingResult?.data?.average_rating != null ? Number(ratingResult.data.average_rating) : null,
                works: Number.isFinite(Number(workResult?.count)) ? Number(workResult.count) : null
            };
            const line = document.getElementById('spot-preview-stats');
            if (line) {
                line.innerHTML = previewStatsHtml();
                if (window.WoIcons) window.WoIcons.hydrate(line);
            }
        } catch (err) {
            console.warn('[spots] estadísticas públicas del artista:', err);
        }
    }

    function previewStatsText() {
        const parts = [];
        if (artistStats.rating != null) parts.push(artistStats.rating.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
        if (artistStats.works != null) parts.push(artistStats.works + ' trabajo' + (artistStats.works === 1 ? '' : 's'));
        return parts.join(' · ') || 'Perfil verificado';
    }

    // Misma línea con la estrella Feather (outline) delante del rating.
    function previewStatsHtml() {
        const text = escapeHtml(previewStatsText());
        return artistStats.rating != null
            ? `<i data-wo-icon="star" aria-hidden="true"></i>${text}`
            : text;
    }

    function paintTopbarAuth() {
        const btn = document.getElementById('auth-nav-btn');
        const label = document.getElementById('auth-nav-label');
        const logout = document.getElementById('auth-logout');
        if (label) {
            label.textContent = artist ? (artist.username || 'Mi panel')
                : session ? 'Completá tu perfil' : 'Ingresá';
        }
        if (btn) {
            btn.href = artist ? '/artist/dashboard'
                : session ? '/register-artist?returnTo=%2Fstudio-spots'
                    : '/artist/login?returnTo=%2Fstudio-spots';
        }
        if (logout) logout.classList.toggle('hidden', !session);
    }

    function wireLogout() {
        const btn = document.getElementById('auth-logout');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            try { await _supabase.auth.signOut(); } catch (err) { console.warn('[spots] logout:', err); }
            window.location.href = '/artist/login?returnTo=%2Fstudio-spots';
        });
    }

    function setupMobileMenu() {
        const toggle = document.getElementById('spots-mobile-menu-toggle');
        const menu = document.getElementById('spots-mobile-menu');
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
            if (event.key !== 'Escape') return;
            menu.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
        });
        window.addEventListener('resize', () => {
            if (window.innerWidth <= MOBILE_MENU_BREAKPOINT) return;
            menu.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
        });
    }

    // ============================================
    // DATOS
    // ============================================

    async function loadSpots() {
        const repo = WeotziData.SpotsOpportunities;
        const { data, error } = repo && typeof repo.listOpenDirectory === 'function'
            ? await repo.listOpenDirectory()
            : await WeotziData.StudioSpots.listOpenWithStudioAndLocation();

        if (error) {
            document.getElementById('spots-mosaic').innerHTML =
                '<div class="wo-alert wo-alert--error">No pudimos cargar los spots: ' + escapeHtml(error.message) + '</div>';
            return;
        }
        allSpots = data || [];
        populateFilterOptions();
        applyFilters();
        openFromQuery({ push: false });
    }

    // ============================================
    // EXPLORAR · búsqueda, filtros y orden (Figma 801:537)
    // ============================================

    async function loadInvitationsCount() {
        const label = document.getElementById('spots-invitations-label');
        const dot = document.getElementById('spots-invitations-dot');
        const repo = WeotziData.SpotsOpportunities;
        if (!session || !artist || !label || !repo) return;
        const { data } = await repo.countPendingInvitations(session.user.id);
        const count = Number(data) || 0;
        label.textContent = count > 0 ? `Invitaciones · ${count}` : 'Invitaciones';
        if (dot) dot.hidden = count === 0;
    }

    function countryOf(s) {
        return (s.location && s.location.country) || '';
    }

    function populateFilterOptions() {
        const fill = (id, values, placeholder) => {
            const select = document.getElementById(id);
            if (!select) return;
            const current = select.value;
            select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
                values.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
            if (values.includes(current)) select.value = current;
        };
        const uniq = list => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
        fill('spots-filter-country', uniq(allSpots.map(countryOf)), 'País');
        const cityPool = filters.country ? allSpots.filter(s => countryOf(s) === filters.country) : allSpots;
        fill('spots-filter-city', uniq(cityPool.map(cityOf)), 'Ciudad');
    }

    function wireExploreControls() {
        const search = document.getElementById('spots-search');
        if (search) {
            search.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    filters.q = search.value.trim().toLowerCase();
                    applyFilters();
                }, 150);
            });
        }
        document.querySelectorAll('.sps-explore-selects select[data-filter]').forEach(select => {
            select.addEventListener('change', () => {
                filters[select.dataset.filter] = select.value;
                if (select.dataset.filter === 'country') {
                    filters.city = '';
                    populateFilterOptions();
                }
                select.closest('.sps-filter')?.classList.toggle('is-active', Boolean(select.value));
                applyFilters();
            });
        });
        const moreToggle = document.getElementById('spots-more-toggle');
        const morePanel = document.getElementById('spots-more-panel');
        moreToggle?.addEventListener('click', () => {
            const open = moreToggle.getAttribute('aria-expanded') !== 'true';
            moreToggle.setAttribute('aria-expanded', String(open));
            if (morePanel) morePanel.hidden = !open;
        });
        [['spots-more-housing', 'housing'], ['spots-more-stipend', 'stipend'], ['spots-more-mystyles', 'mystyles']].forEach(([id, key]) => {
            document.getElementById(id)?.addEventListener('change', (event) => {
                filters[key] = event.target.checked;
                syncMoreToggle();
                applyFilters();
            });
        });
        document.getElementById('spots-clear-filters')?.addEventListener('click', clearFilters);
        document.getElementById('spots-sort')?.addEventListener('change', (event) => {
            sortMode = event.target.value || 'relevance';
            applyFilters();
        });
    }

    function syncMoreToggle() {
        const toggle = document.getElementById('spots-more-toggle');
        if (toggle) toggle.classList.toggle('is-active', filters.housing || filters.stipend || filters.mystyles);
    }

    function clearFilters() {
        Object.assign(filters, { q: '', country: '', city: '', date: '', kind: '', housing: false, stipend: false, mystyles: false });
        const search = document.getElementById('spots-search');
        if (search) search.value = '';
        document.querySelectorAll('.sps-explore-selects select').forEach(select => {
            select.value = '';
            select.closest('.sps-filter')?.classList.remove('is-active');
        });
        ['spots-more-housing', 'spots-more-stipend', 'spots-more-mystyles'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = false;
        });
        syncMoreToggle();
        populateFilterOptions();
        applyFilters();
    }

    function hasActiveFilters() {
        return Boolean(filters.q || filters.country || filters.city || filters.date || filters.kind ||
            filters.housing || filters.stipend || filters.mystyles);
    }

    function daysUntil(iso) {
        const d = parseISODate(iso);
        if (!d) return null;
        return Math.round((d - startOfDay(new Date())) / DAY_MS);
    }

    function matchesFilters(s) {
        if (filters.country && countryOf(s) !== filters.country) return false;
        if (filters.city && cityOf(s) !== filters.city) return false;
        if (filters.kind && s.kind !== filters.kind) return false;
        if (filters.housing && !s.includes_housing) return false;
        if (filters.stipend && !s.stipend_amount) return false;
        if (filters.mystyles) {
            const mine = normalizeList(artist?.styles_array).map(v => String(v).toLowerCase());
            const wanted = normalizeList(s.styles_wanted).map(v => String(v).toLowerCase());
            if (!mine.length || !wanted.some(v => mine.includes(v))) return false;
        }
        if (filters.date) {
            if (filters.date === 'closing') {
                const close = daysToClose(s);
                if (close === null || close > 7) return false;
            } else {
                const start = daysUntil(s.start_date);
                if (start === null) return false;
                if (filters.date === '30' && start > 30) return false;
                if (filters.date === '90' && start > 90) return false;
                if (filters.date === 'later' && start <= 90) return false;
            }
        }
        if (filters.q) {
            const studio = s.studios || {};
            const haystack = [spotName(s), s.title, cityOf(s), countryOf(s), KIND_LABELS[s.kind],
                ...(normalizeList(s.styles_wanted)), studio.tagline].filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(filters.q)) return false;
        }
        return true;
    }

    function sortSpots(list) {
        const byRank = (a, b) => (Number(a.directory_rank) || Number.MAX_SAFE_INTEGER) - (Number(b.directory_rank) || Number.MAX_SAFE_INTEGER);
        const sorted = list.slice();
        if (sortMode === 'closing') {
            sorted.sort((a, b) => (daysToClose(a) ?? Infinity) - (daysToClose(b) ?? Infinity) || byRank(a, b));
        } else if (sortMode === 'recent') {
            sorted.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0) || byRank(a, b));
        } else if (sortMode === 'split') {
            sorted.sort((a, b) => (Number(b.revenue_split_pct) || 0) - (Number(a.revenue_split_pct) || 0) || byRank(a, b));
        } else {
            sorted.sort(byRank);
        }
        return sorted;
    }

    function applyFilters() {
        spots = sortSpots(allSpots.filter(matchesFilters));
        const countEl = document.getElementById('spots-count');
        const labelEl = document.getElementById('spots-count-label');
        if (countEl) countEl.textContent = String(spots.length);
        if (labelEl) labelEl.textContent = spots.length === 1 ? 'Oportunidad encontrada' : 'Oportunidades encontradas';
        renderDirectory();
    }

    // ---- helpers de contenido ----

    function spotName(s) {
        const studio = s.studios || {};
        return studio.name || s.title || 'Estudio';
    }

    function cityOf(s) {
        const loc = s.location || {};
        return loc.city || '';
    }

    function cityCountryOf(s) {
        const loc = s.location || {};
        return [loc.city, loc.country].filter(Boolean).join(', ');
    }

    function durationText(s) {
        if (s.weeks_minimum) {
            if (Number(s.weeks_minimum) >= 8) {
                const minMonths = Math.max(1, Math.round(Number(s.weeks_minimum) / 4));
                const maxMonths = s.weeks_maximum ? Math.max(minMonths, Math.round(Number(s.weeks_maximum) / 4)) : minMonths;
                return maxMonths !== minMonths
                    ? `${minMonths} a ${maxMonths} meses`
                    : `${minMonths} mes${minMonths === 1 ? '' : 'es'}`;
            }
            return s.weeks_maximum && s.weeks_maximum !== s.weeks_minimum
                ? `${s.weeks_minimum} a ${s.weeks_maximum} semanas`
                : `${s.weeks_minimum} semana${s.weeks_minimum === 1 ? '' : 's'}`;
        }
        if (s.start_date && s.end_date) {
            const months = Math.round((new Date(s.end_date) - new Date(s.start_date)) / (30 * DAY_MS));
            if (months >= 1) return `${months} mes${months === 1 ? '' : 'es'}`;
        }
        return '';
    }

    function splitText(s) {
        return showsSplit(s) ? `Split ${Number(s.revenue_split_pct).toFixed(0)}%` : '';
    }

    function stipendText(s) {
        if (!s.stipend_amount) return '';
        return `Stipend ${formatMoney(s.stipend_amount)} ${s.stipend_currency || ''}`.trim();
    }

    // ---- modalidad y beneficios (M2; sin la migración, los campos no llegan
    // y se muestra lo de siempre: split y stipend) ----

    function compensationModel(s) {
        const model = s && s.compensation_model;
        return Object.prototype.hasOwnProperty.call(COMPENSATION_LABELS, model) ? model : null;
    }

    // Con modalidad "Pago fijo" el porcentaje no aplica aunque la columna
    // legacy revenue_split_pct tenga valor.
    function showsSplit(s) {
        return s.revenue_split_pct != null && s.revenue_split_pct !== '' && compensationModel(s) !== 'fixed';
    }

    // "150.000 ARS por mes" (solo con modalidad fija o mixta y monto cargado).
    function fixedAmountText(s) {
        const model = compensationModel(s);
        if (model !== 'fixed' && model !== 'mixed') return '';
        if (s.fixed_amount == null || s.fixed_amount === '') return '';
        const amount = Number(s.fixed_amount);
        if (!Number.isFinite(amount)) return '';
        const currency = /^[A-Z]{3}$/.test(String(s.fixed_currency || '')) ? s.fixed_currency : '';
        return [formatMoney(amount) + (currency ? ' ' + currency : ''), FIXED_PERIOD_SUFFIX[s.fixed_period] || '']
            .filter(Boolean).join(' ');
    }

    // Versión corta para las tarjetas: "Alquiler 150.000 ARS por mes".
    function fixedShortText(s) {
        const amount = fixedAmountText(s);
        return amount ? `${FIXED_PAYER_SHORT[s.fixed_payer] || 'Fijo'} ${amount}` : '';
    }

    function fixedPayerText(s) {
        return fixedAmountText(s) ? (FIXED_PAYER_LABELS[s.fixed_payer] || '') : '';
    }

    function benefitTags(s) {
        return normalizeList(s && s.benefit_tags).map(t => String(t == null ? '' : t).trim()).filter(Boolean).slice(0, 6);
    }

    // "Beneficios: Hospedaje · Insumos incluidos · +2".
    function benefitsLine(s, limit) {
        const tags = benefitTags(s);
        if (tags.length === 0) return '';
        const max = limit || 3;
        const shown = tags.slice(0, max).join(' · ');
        return `Beneficios: ${shown}${tags.length > max ? ` · +${tags.length - max}` : ''}`;
    }

    // Condiciones en una línea (resumen de "Solicitud enviada").
    function conditionsText(s) {
        return [
            showsSplit(s) ? `${Number(s.revenue_split_pct).toFixed(0)}% para el artista` : '',
            fixedShortText(s),
            stipendText(s)
        ].filter(Boolean).join(' · ');
    }

    // Línea mono del Figma: "3 a 6 meses · Split 66% · Stipend 1.000 EUR".
    // Con modalidad fija o mixta suma "Alquiler 150.000 ARS por mes" (o "Pago
    // al artista …"). El cierre solo se anuncia cuando está cerca (≤ 14 días),
    // como en el Figma.
    function metaLine(s) {
        const close = daysToClose(s);
        return [durationText(s), splitText(s), fixedShortText(s), stipendText(s), close !== null && close <= 14 ? closingText(s) : '']
            .filter(Boolean).join(' · ');
    }

    function daysToClose(s) {
        if (!s.expires_at) return null;
        const diff = new Date(s.expires_at) - Date.now();
        if (diff <= 0) return 0;
        return Math.ceil(diff / DAY_MS);
    }

    function closingText(s) {
        const d = daysToClose(s);
        if (d === null) return '';
        if (d === 0) return 'Cierra hoy';
        return `Cierra en ${d} día${d === 1 ? '' : 's'}`;
    }

    function styleChips(s, limit) {
        const list = (s.styles_wanted || []).slice(0, limit || 4);
        if (list.length === 0) return '';
        return list.map(st => `<span class="sps-tag">${escapeHtml(st)}</span>`).join('');
    }

    // Figma 801:537 alterna la marca por posición (cuadrado rojo → triángulo azul →
    // círculo amarillo) en el mosaico y en la cinta; sin posición, la marca es por tipo.
    const MARK_ROTATION = ['square', 'triangle', 'circle'];
    function markHtml(kind, slot) {
        const shape = Number.isInteger(slot) ? MARK_ROTATION[((slot % 3) + 3) % 3] : null;
        return `<span class="sps-mark ${shape ? `sps-mark--${shape}` : `sps-mark--${escapeAttr(kind)}`}" aria-hidden="true"></span>`;
    }

    const SPONSORED_BADGE = '<span class="sps-sponsored-badge"><i data-wo-icon="star" aria-hidden="true"></i>Patrocinado</span>';

    function descriptionOf(s) {
        const studio = s.studios || {};
        return s.description || studio.tagline || studio.bio || '';
    }

    function spotMediaOf(s) {
        const studio = s.studios || {};
        const attachments = normalizeList(s.attachments || s.studio_spot_attachments)
            .slice()
            .sort((a, b) => Number(a?.sort_order || 0) - Number(b?.sort_order || 0));
        const fallback = FIGMA_SPOT_FALLBACK_IMAGES[studio.slug] || '';
        return [...new Set([
            s.cover_image,
            ...attachments.map(item => (item && typeof item === 'object' ? (item.file_url || item.url) : item)),
            fallback
        ].filter(u => typeof u === 'string' && u))];
    }

    function photosOf(s) {
        const studio = s.studios || {};
        const feed = Array.isArray(studio.photo_feed_items) ? studio.photo_feed_items : [];
        const urls = [
            ...spotMediaOf(s),
            ...feed.map(p => (p && typeof p === 'object' ? p.url : p)),
            studio.cover_image
        ].filter(u => typeof u === 'string' && u);
        return [...new Set(urls)].slice(0, 4);
    }

    function isFeatured(s) {
        return s?.is_featured === true || s?.is_featured === 'true';
    }

    function featuredRank(s) {
        const rank = Number(s?.featured_rank);
        return Number.isFinite(rank) && rank > 0 ? rank : Number.MAX_SAFE_INTEGER;
    }

    function partitionSpotsForLayout(source) {
        const featured = source
            .filter(isFeatured)
            .slice()
            .sort((a, b) => featuredRank(a) - featuredRank(b));
        const hero = featured.find(s => featuredRank(s) === 1) || featured[0] || source[0] || null;
        const secondaryFeatured = featured.filter(s => !hero || s.id !== hero.id);
        const organic = source.filter(s => (!hero || s.id !== hero.id) && !isFeatured(s));
        const mosaic = organic.slice(0, 4).map(spot => ({ spot, layout: 'organic' }));

        if (secondaryFeatured[0]) {
            mosaic.push({ spot: secondaryFeatured[0], layout: 'promoted' });
        }

        organic.slice(4).forEach(spot => {
            if (mosaic.length < MOSAIC_SLOTS) mosaic.push({ spot, layout: 'organic' });
        });
        secondaryFeatured.slice(1).forEach(spot => {
            if (mosaic.length < MOSAIC_SLOTS) mosaic.push({ spot, layout: 'featured' });
        });

        return { hero, mosaic };
    }

    // ============================================
    // VISTAS
    // ============================================

    function showView(name) {
        const views = {
            feed: document.getElementById('spots-feed-view'),
            detail: document.getElementById('spot-detail-view'),
            sent: document.getElementById('spot-sent-view')
        };
        Object.entries(views).forEach(([key, el]) => {
            if (el) el.classList.toggle('hidden', key !== name);
        });
        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function syncUrl(spot, push) {
        if (!window.history?.pushState) return;
        const url = new URL(window.location.href);
        if (spot) url.searchParams.set('spot', spot.id);
        else url.searchParams.delete('spot');
        if (push) window.history.pushState(null, '', url);
        else window.history.replaceState(null, '', url);
    }

    function openFromQuery(options = {}) {
        const id = new URLSearchParams(window.location.search).get('spot');
        if (!id) {
            currentSpot = null;
            showView('feed');
            return;
        }
        const spot = allSpots.find(x => x.id === id);
        if (!spot) { showView('feed'); return; }
        // ?spot=<id>&estado=enviada → confirmación de una postulación ya enviada (QA y deep link).
        if (new URLSearchParams(window.location.search).get('estado') === 'enviada') {
            openSentFromQuery(spot);
            return;
        }
        openDetail(spot, { push: options.push === true });
    }

    async function openSentFromQuery(spot) {
        const application = await existingApplication(spot);
        if (!application) { openDetail(spot, { push: false }); return; }
        const state = await applicationState(application, spot);
        renderSent(spot, application, state);
    }

    // Estado real de la postulación (mismo criterio que Mis postulaciones): una
    // contraoferta pendiente del estudio o un spot cerrado pisan el status crudo.
    async function applicationState(application, spot) {
        let offers = [];
        if (application?.id && typeof WeotziData.StudioSpots?.listCounterOffers === 'function') {
            try {
                const { data } = await WeotziData.StudioSpots.listCounterOffers(application.id);
                offers = Array.isArray(data) ? data : [];
            } catch (err) {
                console.warn('[spots] contraofertas de la postulación:', err);
            }
        }
        const spotRow = application?.studio_spots || spot || null;
        const S = window.WoApplicationState;
        if (S) return { key: S.deriveSpot(application, spotRow, offers), label: S.label(S.deriveSpot(application, spotRow, offers)) };
        const fallback = { pending: 'Esperando respuesta', shortlisted: 'En revisión', accepted: 'Confirmada', rejected: 'Rechazada', withdrawn: 'Retirada' };
        return { key: application?.status || 'pending', label: fallback[application?.status] || 'Esperando respuesta' };
    }

    function rawStatusLabel(status) {
        const S = window.WoApplicationState;
        if (S) return S.rawSpotLabel(status);
        return ({ pending: 'Esperando respuesta', shortlisted: 'En revisión', accepted: 'Confirmada', rejected: 'Rechazada', withdrawn: 'Retirada' })[status] || 'Esperando respuesta';
    }

    async function existingApplication(spot) {
        if (!session || !artist || !spot) return null;
        try {
            const { data } = await WeotziData.StudioSpots.getApplication(spot.id, session.user.id);
            if (!data) return null;
            const { data: rows } = await (WeotziData.SpotsOpportunities
                ? WeotziData.SpotsOpportunities.listApplicationsByArtist(session.user.id)
                : WeotziData.StudioSpots.listApplicationsByArtist(session.user.id));
            return (rows || []).find(row => row.id === data.id) || data;
        } catch (err) {
            console.warn('[spots] postulación existente:', err);
            return null;
        }
    }

    function backToDirectory() {
        currentSpot = null;
        syncUrl(null, true);
        showView('feed');
    }

    // ============================================
    // DIRECTORIO (ref 05)
    // ============================================

    function renderDirectory() {
        const featureEl = document.getElementById('spots-feature');
        const mosaicEl = document.getElementById('spots-mosaic');
        const ribbonEl = document.getElementById('spots-ribbon');
        const emptyEl = document.getElementById('spots-empty');

        if (spots.length === 0) {
            featureEl.innerHTML = '';
            mosaicEl.innerHTML = '';
            ribbonEl.innerHTML = '';
            const filtered = hasActiveFilters() && allSpots.length > 0;
            const title = document.getElementById('spots-empty-title');
            const text = document.getElementById('spots-empty-text');
            if (title) title.textContent = filtered ? 'Ningún spot coincide con tu búsqueda' : 'No hay spots abiertos';
            if (text) {
                text.innerHTML = filtered
                    ? 'Probá con otros filtros o <button type="button" class="sps-empty-reset" id="spots-empty-reset">limpiá la búsqueda</button>.'
                    : 'Volvé más tarde: los estudios publican sus posiciones acá.';
                document.getElementById('spots-empty-reset')?.addEventListener('click', clearFilters);
            }
            emptyEl.classList.remove('hidden');
            return;
        }
        emptyEl.classList.add('hidden');

        const layout = partitionSpotsForLayout(spots);
        featureEl.innerHTML = layout.hero ? renderFeature(layout.hero) : '';
        // La rotación de marcas cuenta solo las fichas orgánicas (la promovida lleva su círculo en tinta).
        let markSlot = 0;
        mosaicEl.innerHTML = layout.mosaic.map((entry, i) => renderTile(entry.spot, i, entry.layout,
            entry.layout === 'promoted' ? null : 1 + markSlot++)).join('');
        // Con menos piezas que el mosaico completo, la grilla deja de reservar filas fijas.
        const hasPromoted = layout.mosaic.some(entry => entry.layout === 'promoted');
        mosaicEl.classList.toggle('is-partial', layout.mosaic.length < MOSAIC_SLOTS || !hasPromoted);
        mosaicEl.hidden = layout.mosaic.length === 0;
        const shown = new Set([layout.hero && layout.hero.id].concat(layout.mosaic.map(entry => entry.spot.id)).filter(Boolean));
        ribbonEl.innerHTML = renderRibbon(shown);

        document.querySelectorAll('[data-spot-open]').forEach(el => {
            el.addEventListener('click', (event) => {
                event.preventDefault();
                const spot = allSpots.find(x => x.id === el.dataset.spotOpen);
                if (spot) openDetail(spot);
            });
        });
    }

    // Franja destacada persistente: rank 1. Si todavía no existe curaduría en
    // datos, se conserva un fallback al primer spot para no dejar el directorio
    // sin apertura editorial.
    function renderFeature(s) {
        const cover = spotMediaOf(s)[0] || '';
        const city = cityOf(s);
        const eyebrow = [KIND_LABELS[s.kind] || s.kind, city].filter(Boolean).join(' · ');
        const desc = descriptionOf(s);

        return `
            <article class="sps-feature" data-spot-layout="hero">
                <div class="sps-feature-media${cover ? ' has-image' : ''}" ${cover ? `style="background-image:url('${cssEscape(cover)}')"` : ''}>
                    ${isFeatured(s) ? SPONSORED_BADGE : ''}
                    ${cover ? '' : mediaPlaceholder('Foto del estudio')}
                </div>
                <div class="sps-feature-body">
                    <span class="sps-feature-eyebrow"><span class="sps-mark sps-mark--hero" aria-hidden="true"></span> ${escapeHtml(eyebrow)}</span>
                    <h2 class="sps-feature-title">${escapeHtml(spotName(s))}</h2>
                    ${metaLine(s) ? `<span class="sps-feature-meta">${escapeHtml(metaLine(s))}</span>` : ''}
                    ${benefitsLine(s) ? `<span class="sps-feature-meta" data-spot-benefits>${escapeHtml(benefitsLine(s))}</span>` : ''}
                    ${styleChips(s, 3) ? `<div class="sps-styles">${styleChips(s, 3)}</div>` : ''}
                    ${desc ? `<p class="sps-feature-desc">${escapeHtml(truncate(desc, 130))}</p>` : ''}
                    <div class="sps-feature-actions">
                        <button type="button" class="wo-btn wo-btn--direct wo-btn--hard" data-spot-open="${escapeAttr(s.id)}">
                            Postularme <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="wo-btn wo-btn--secondary" data-spot-open="${escapeAttr(s.id)}">Ver detalles</button>
                    </div>
                </div>
            </article>
        `;
    }

    // Mosaico bento: 2 tiles grandes (blanco / arena) + 4 compactos.
    function renderTile(s, index, layout, markSlot) {
        if (layout === 'promoted') return renderPromotedTile(s);

        const close = daysToClose(s);
        const urgent = close !== null && close <= 2;
        const large = index < 2;
        const featuredBadge = isFeatured(s) ? SPONSORED_BADGE : '';
        const city = cityOf(s);
        const eyebrow = [KIND_LABELS[s.kind] || s.kind, city].filter(Boolean).join(' · ');
        const cover = large ? (spotMediaOf(s)[0] || '') : '';

        let variant = large ? (index === 0 ? 'sps-tile--paper' : 'sps-tile--sand') : 'sps-tile--paper';
        if (!large) {
            if (urgent) variant = 'sps-tile--urgent';
            else if (index % 2 === 1) variant = 'sps-tile--cream';
        }
        if (cover) variant += ' sps-tile--image';

        if (large) {
            const desc = descriptionOf(s);
            return `
                <article class="sps-tile sps-tile--large ${variant}" data-spot-open="${escapeAttr(s.id)}"
                    data-spot-layout="large" ${cover ? `style="background-image:url('${cssEscape(cover)}')"` : ''}>
                    ${featuredBadge}
                    <span class="sps-tile-top">${markHtml(s.kind, markSlot)}<span class="sps-tile-city">${escapeHtml(eyebrow)}</span></span>
                    <h3 class="sps-tile-name">${escapeHtml(spotName(s))}</h3>
                    ${metaLine(s) ? `<span class="sps-tile-meta">${escapeHtml(metaLine(s))}</span>` : ''}
                    ${benefitsLine(s) ? `<span class="sps-tile-meta" data-spot-benefits>${escapeHtml(benefitsLine(s))}</span>` : ''}
                    ${styleChips(s, 3) ? `<div class="sps-styles">${styleChips(s, 3)}</div>` : ''}
                    ${desc ? `<p class="sps-tile-desc">${escapeHtml(truncate(desc, 150))}</p>` : ''}
                    <span class="wo-btn wo-btn--direct sps-tile-cta">
                        Postularme <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
                    </span>
                </article>
            `;
        }

        // Urgente (Figma 107:5373): sin marca; ciudad y cierre debajo del nombre.
        if (urgent) {
            return `
                <article class="sps-tile ${variant}" data-spot-open="${escapeAttr(s.id)}" data-spot-layout="urgent">
                    ${featuredBadge}
                    <span class="sps-tile-urgency">Última oportunidad</span>
                    <h3 class="sps-tile-name">${escapeHtml(spotName(s))}</h3>
                    <span class="sps-tile-meta">${escapeHtml([city, closingText(s)].filter(Boolean).join(' · '))}</span>
                </article>
            `;
        }

        // Itinerante (Figma 107:5380): ficha de texto mono en una sola línea editorial.
        if (s.kind === 'itinerant') {
            return `
                <article class="sps-tile sps-tile--itinerant ${variant}" data-spot-open="${escapeAttr(s.id)}" data-spot-layout="itinerant">
                    ${featuredBadge}
                    <span class="sps-tile-kind">${escapeHtml(KIND_LABELS.itinerant)}</span>
                    <p class="sps-tile-itinerary">${escapeHtml(itinerantLine(s))}</p>
                </article>
            `;
        }

        return `
            <article class="sps-tile ${variant}" data-spot-open="${escapeAttr(s.id)}" data-spot-layout="${layout === 'featured' ? 'featured' : 'compact'}">
                ${featuredBadge}
                <span class="sps-tile-top">${markHtml(s.kind, markSlot)}<span class="sps-tile-city">${escapeHtml(city || KIND_LABELS[s.kind] || '')}</span></span>
                <h3 class="sps-tile-name">${escapeHtml(spotName(s))}</h3>
                ${metaLine(s) ? `<span class="sps-tile-meta">${escapeHtml(metaLine(s))}</span>` : ''}
            </article>
        `;
    }

    // "Línea Fina Studio, Villa Crespo, BA. 2 semanas, Fine line / Minimalista, split 65%. Cierra en 5 días."
    function itinerantLine(s) {
        const loc = s.location || {};
        const place = String(loc.formatted_address || loc.city || '').split(',')[0].trim();
        const head = [spotName(s), place, loc.city && loc.city !== place ? loc.city : ''].filter(Boolean).join(', ');
        const fixed = fixedShortText(s);
        const terms = [
            durationText(s),
            normalizeList(s.styles_wanted).slice(0, 2).join(' / '),
            showsSplit(s) ? `split ${Number(s.revenue_split_pct).toFixed(0)}%` : '',
            fixed ? fixed.charAt(0).toLowerCase() + fixed.slice(1) : ''
        ].filter(Boolean).join(', ');
        return [head, terms, closingText(s)].filter(Boolean).map(part => part.replace(/\.$/, '')).join('. ') + '.';
    }

    function renderPromotedTile(s) {
        const cover = spotMediaOf(s)[0] || '';
        const desc = descriptionOf(s);
        const city = cityOf(s);
        const eyebrow = [KIND_LABELS[s.kind] || s.kind, city].filter(Boolean).join(' · ');

        return `
            <article class="sps-tile sps-tile--promoted" data-spot-open="${escapeAttr(s.id)}" data-spot-layout="promoted">
                ${SPONSORED_BADGE}
                <span class="sps-tile-top">${markHtml(s.kind)}<span class="sps-tile-city">${escapeHtml(eyebrow)}</span></span>
                <h3 class="sps-tile-name">${escapeHtml(spotName(s))}</h3>
                ${metaLine(s) ? `<span class="sps-tile-meta">${escapeHtml(metaLine(s))}</span>` : ''}
                ${benefitsLine(s) ? `<span class="sps-tile-meta" data-spot-benefits>${escapeHtml(benefitsLine(s))}</span>` : ''}
                ${styleChips(s, 3) ? `<div class="sps-styles">${styleChips(s, 3)}</div>` : ''}
                <div class="sps-promoted-media${cover ? ' has-image' : ''}" ${cover ? `style="background-image:url('${cssEscape(cover)}')"` : ''}>
                    ${cover ? '' : mediaPlaceholder('Foto del estudio')}
                </div>
                ${desc ? `<p class="sps-tile-desc">${escapeHtml(truncate(desc, 170))}</p>` : ''}
                <span class="wo-btn wo-btn--direct sps-tile-cta">
                    Postularme <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
                </span>
                <span class="sps-promoted-details">Ver detalles</span>
            </article>
        `;
    }

    function mediaPlaceholder(label) {
        return `
            <span class="sps-media-placeholder" aria-hidden="true">
                <i data-wo-icon="image" class="wo-icon-24"></i>
                <strong>${escapeHtml(label)}</strong>
            </span>
        `;
    }

    // Cinta inferior: primero los spots que no entraron en la franja ni en el
    // mosaico; si sobran celdas, se completan con los que cierran antes.
    function renderRibbon(shown) {
        const byClose = (a, b) => (daysToClose(a) ?? Infinity) - (daysToClose(b) ?? Infinity);
        const rest = spots.filter(s => !shown || !shown.has(s.id));
        const fill = spots.filter(s => shown && shown.has(s.id) && daysToClose(s) !== null).sort(byClose);
        const closing = rest.concat(fill).slice(0, RIBBON_SLOTS);
        if (closing.length === 0 || (shown && rest.length === 0 && spots.length < MOSAIC_SLOTS)) return '';

        return closing.map((s, i) => `
            <a class="sps-ribbon-cell" href="?spot=${encodeURIComponent(s.id)}" data-spot-open="${escapeAttr(s.id)}">
                ${markHtml(s.kind, i)}
                <span>${escapeHtml([spotName(s), cityOf(s), closingText(s)].filter(Boolean).join(' · '))}</span>
            </a>
        `).join('');
    }

    // ============================================
    // DETALLE DEL SPOT (ref 06)
    // ============================================

    function includesList(s) {
        const editorial = normalizeList(s.studio_includes);
        if (editorial.length) return editorial;
        const items = [];
        if (s.includes_housing) items.push('Alojamiento incluido durante el spot');
        if (s.stipend_amount) items.push(`Stipend de ${formatMoney(s.stipend_amount)} ${s.stipend_currency || ''}`.trim());
        return items;
    }

    function expectationsList(s) {
        const editorial = normalizeList(s.artist_expectations);
        if (editorial.length) return editorial;
        const items = [];
        if ((s.styles_wanted || []).length) items.push(`Portfolio con foco en ${s.styles_wanted.join(' o ')}`);
        if (s.weeks_minimum) items.push(`Disponibilidad mínima de ${s.weeks_minimum} semana${s.weeks_minimum === 1 ? '' : 's'}`);
        return items;
    }

    function requirementsList(s) {
        const editorial = normalizeList(s.minimum_requirements);
        if (editorial.length) return editorial;
        const items = [];
        if (s.experience_min_years) items.push(`Mínimo ${s.experience_min_years} año${s.experience_min_years === 1 ? '' : 's'} de experiencia profesional`);
        if ((s.language_requirements || []).length) items.push(`Idiomas: ${s.language_requirements.join(' · ')}`);
        return items;
    }

    function bulletList(label, items) {
        if (items.length === 0) return '';
        return `
            <div class="sps-bullets">
                <span class="sps-label">${escapeHtml(label)}</span>
                <ul>${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
            </div>
        `;
    }

    function detailCells(s) {
        const cells = [];
        if (s.availability_summary || s.start_date) cells.push(['Fechas disponibles', s.availability_summary || formatDateRange(s.start_date, s.end_date)]);
        if (durationText(s)) cells.push(['Duración', durationText(s)]);
        const model = compensationModel(s);
        if (model) cells.push(['Modalidad', COMPENSATION_LABELS[model]]);
        if (showsSplit(s)) cells.push(['Split / comisión', `${Number(s.revenue_split_pct).toFixed(0)}% para el artista`]);
        if (fixedAmountText(s)) cells.push(['Pago fijo', fixedAmountText(s)]);
        if (fixedPayerText(s)) cells.push(['Quién paga', fixedPayerText(s)]);
        if (s.stipend_amount) cells.push(['Stipend', `${formatMoney(s.stipend_amount)} ${s.stipend_currency || ''}${stipendFrequencySuffix(s)}`.trim()]);
        return cells;
    }

    // "Detalles de la oportunidad": tipo + celdas (fechas, duración, modalidad…).
    function termsHtml(s) {
        const cells = detailCells(s);
        if (!cells.length) return '';
        return `
                    <div class="sps-opportunity-head">
                        <span class="sps-kind-badge">${escapeHtml(KIND_LABELS[s.kind] || s.kind)}</span>
                        <span>Detalles de la oportunidad</span>
                    </div>
                    <div class="sps-meta-grid">
                        ${cells.map(([k, v]) => `
                            <div class="sps-meta-row">
                                <span class="sps-meta-key">${escapeHtml(k)}</span>
                                <span class="sps-meta-val">${escapeHtml(v)}</span>
                            </div>
                        `).join('')}
                    </div>
        `;
    }

    // Beneficios del spot (benefit_tags, hasta 6) como etiquetas.
    function benefitsHtml(s) {
        const tags = benefitTags(s);
        if (!tags.length) return '';
        return `
                    <div class="sps-bullets sps-benefits">
                        <span class="sps-label">Beneficios</span>
                        <div class="sps-styles">${tags.map(t => `<span class="sps-tag">${escapeHtml(t)}</span>`).join('')}</div>
                    </div>
        `;
    }

    // El directorio puede venir del select previo, sin las columnas de M2:
    // al abrir el detalle se completan modalidad y beneficios con la fila del
    // spot (StudioSpots.getById, '*': trae lo que exista). Sin la migración no
    // cambia nada.
    async function enrichSpotTerms(s) {
        const repo = WeotziData.StudioSpots;
        if (!s || !s.id || termsLoaded.has(s) || !repo || typeof repo.getById !== 'function') return;
        if (SPOT_TERM_KEYS.every(key => Object.prototype.hasOwnProperty.call(s, key))) return;
        termsLoaded.add(s);
        try {
            const { data, error } = await repo.getById(s.id);
            if (error || !data) return;
            let changed = false;
            SPOT_TERM_KEYS.forEach(key => {
                if (Object.prototype.hasOwnProperty.call(data, key) && !Object.prototype.hasOwnProperty.call(s, key)) {
                    s[key] = data[key];
                    changed = true;
                }
            });
            if (!changed || currentSpot?.id !== s.id) return;
            const terms = document.getElementById('spot-terms');
            const benefits = document.getElementById('spot-benefits');
            if (terms) terms.innerHTML = termsHtml(s);
            if (benefits) benefits.innerHTML = benefitsHtml(s);
        } catch (err) {
            console.warn('[spots] modalidad del spot:', err);
        }
    }

    function stipendFrequencySuffix(s) {
        const labels = {
            monthly: ' mensuales',
            weekly: ' semanales',
            daily: ' por día',
            one_time: ' total'
        };
        return labels[s.stipend_frequency] || (s.stipend_frequency ? ` ${s.stipend_frequency}` : '');
    }

    function renderPhotoSlot(url, index) {
        if (url) {
            return `<span class="sps-gallery-item has-image" style="background-image:url('${cssEscape(url)}')" role="img" aria-label="Foto ${index} del estudio"></span>`;
        }
        return `<span class="sps-gallery-item">${mediaPlaceholder(`Foto ${index}`)}</span>`;
    }

    function buildDetailMain(s) {
        const studio = s.studios || {};
        const photos = photosOf(s);
        const desc = descriptionOf(s);
        const website = safeHref(studio.website);

        return `
            <div class="sps-detail-hero">
                <button type="button" class="sps-back" id="spot-back">
                    <i data-wo-icon="arrow-left" class="wo-icon-18" aria-hidden="true"></i> Volver a spots
                </button>

                ${cityCountryOf(s) ? `
                    <span class="sps-detail-place">
                        <i data-wo-icon="map-pin" class="wo-icon-18" aria-hidden="true"></i> ${escapeHtml(cityCountryOf(s))}
                    </span>
                ` : ''}
                <h1 class="sps-detail-title">${escapeHtml(spotName(s))}</h1>

                <div class="sps-gallery">
                    ${Array.from({ length: 4 }, (_, index) => renderPhotoSlot(photos[index], index + 1)).join('')}
                </div>
            </div>

            <div class="sps-detail-content">
                ${desc ? `<p class="sps-detail-desc">${escapeHtml(desc)}</p>` : ''}

                <div class="sps-links" id="spot-links">
                    ${studio.instagram ? `<a href="https://instagram.com/${encodeURIComponent(String(studio.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener"><i data-wo-icon="instagram" class="wo-icon-18" aria-hidden="true"></i> @${escapeHtml(String(studio.instagram).replace(/^@/, ''))}</a>` : ''}
                    ${website ? `<a href="${escapeAttr(website)}" target="_blank" rel="noopener"><i data-wo-icon="external-link" class="wo-icon-18" aria-hidden="true"></i> ${escapeHtml(String(studio.website).replace(/^https?:\/\//, ''))}</a>` : ''}
                    <span id="spot-roster" hidden></span>
                </div>

                <div class="sps-detail-chips">
                    ${styleChips(s, 6)}
                </div>

                <div id="spot-terms">${termsHtml(s)}</div>

                <div class="sps-bullet-cols">
                    ${bulletList('Qué incluye el estudio', includesList(s))}
                    ${bulletList('Qué espera del artista', expectationsList(s))}
                    ${bulletList('Requisitos mínimos', requirementsList(s))}
                </div>

                <div id="spot-benefits">${benefitsHtml(s)}</div>
            </div>
        `;
    }

    function artistPreviewHtml() {
        if (!artist) return '';
        const name = artist.username || artist.name || '';
        const initial = (name || 'A').trim().charAt(0).toUpperCase();
        const city = artist.city || String(artist.ubicacion || '').split(',')[0].trim();
        const styles = normalizeList(artist.styles_array).slice(0, 3);
        const shots = normalizeList(artist.gallery_images).filter(u => typeof u === 'string').slice(0, 3);
        const shotSlots = Array.from({ length: 3 }, (_, index) => {
            const url = shots[index];
            return url
                ? `<span class="sps-preview-shot has-image"><img src="${escapeAttr(url)}" alt="Trabajo ${index + 1} del portfolio" loading="lazy"></span>`
                : `<span class="sps-preview-shot">${mediaPlaceholder('Portfolio')}</span>`;
        }).join('');

        return `
            <span class="sps-label sps-preview-label">Portfolio</span>
            <div class="sps-preview">
                <div class="sps-preview-id">
                    <span class="sps-preview-avatar">${artist.profile_picture ? `<img src="${escapeAttr(artist.profile_picture)}" alt="">` : escapeHtml(initial)}</span>
                    <div>
                        <span class="sps-preview-name">${escapeHtml(name)}</span>
                        <span class="sps-preview-stats" id="spot-preview-stats">${previewStatsHtml()}</span>
                    </div>
                    ${city ? `<span class="sps-preview-city"><i data-wo-icon="map-pin" aria-hidden="true"></i>${escapeHtml(city)}</span>` : ''}
                </div>
                ${styles.length ? `<div class="sps-styles">${styles.map(st => `<span class="sps-tag">${escapeHtml(st)}</span>`).join('')}</div>` : ''}
                <div class="sps-preview-shots">${shotSlots}</div>
            </div>
        `;
    }

    function buildApplyAside(s) {
        if (!session) {
            return `
                <h2 class="sps-aside-title">Postularme a este spot</h2>
                <p class="sps-aside-sub">Elegí tus fechas y presentate ante el estudio.</p>
                <a class="wo-btn wo-btn--direct wo-btn--block wo-btn--hard" href="/artist/login?returnTo=${encodeURIComponent('/studio-spots/?spot=' + s.id)}">
                    Ingresá para postular <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
                </a>
                <p class="sps-apply-help">¿Todavía no sos artista en We Ötzi? <a href="/register-artist">Registrate gratis</a>.</p>
            `;
        }
        if (!artist) {
            return `
                <h2 class="sps-aside-title">Postularme a este spot</h2>
                <div class="wo-alert wo-alert--info">
                    Solo las cuentas de artista pueden postularse. Completá tu perfil de artista para enviar la solicitud.
                </div>
                <a class="wo-btn wo-btn--direct wo-btn--block wo-btn--hard" href="/register-artist?returnTo=${encodeURIComponent('/studio-spots/?spot=' + s.id)}">
                    Completar mi perfil <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
                </a>
            `;
        }

        return `
            <h2 class="sps-aside-title">Postularme a este spot</h2>
            <p class="sps-aside-sub">Elegí tus fechas y presentate ante el estudio.</p>

            <span class="sps-label">Fechas disponibles</span>
            <div class="sps-cal" id="spot-cal"></div>
            <p class="sps-cal-summary" id="spot-cal-summary" aria-live="polite" hidden></p>

            <div class="wo-field">
                <label class="wo-label" for="apply-message">Mensaje de presentación</label>
                <textarea id="apply-message" class="wo-textarea" rows="4" placeholder="Contale al estudio por qué te gustaría hacer este spot…"></textarea>
            </div>

            ${artistPreviewHtml()}

            <button id="apply-submit" class="wo-btn wo-btn--direct wo-btn--block wo-btn--hard">
                Enviar solicitud <i data-wo-icon="send" class="wo-icon-18" aria-hidden="true"></i>
            </button>
            <div id="apply-status" class="wo-alert wo-alert--error" hidden></div>
        `;
    }

    async function openDetail(s, options = {}) {
        const view = document.getElementById('spot-detail-view');
        if (!view || !s) return;

        currentSpot = s;
        resetCalendar(s);

        view.innerHTML = `
            <div class="sps-detail-main">${buildDetailMain(s)}</div>
            <aside class="sps-detail-aside" aria-label="Postularme a este spot">${buildApplyAside(s)}</aside>
        `;

        document.getElementById('spot-back')?.addEventListener('click', backToDirectory);
        syncUrl(s, options.push !== false);
        showView('detail');

        renderCalendar();
        wireApply(s);
        loadRosterCount(s);
        markAlreadyApplied(s);
        enrichSpotTerms(s);
    }

    // Si el artista ya se postuló, el aside muestra el estado en lugar del formulario.
    async function markAlreadyApplied(s) {
        const application = await existingApplication(s);
        if (!application || currentSpot?.id !== s.id) return;
        const state = await applicationState(application, s);
        const aside = document.querySelector('#spot-detail-view .sps-detail-aside');
        if (!aside || currentSpot?.id !== s.id) return;
        aside.innerHTML = `
            <h2 class="sps-aside-title">Ya te postulaste a este spot</h2>
            <p class="sps-aside-sub">Enviaste tu solicitud el ${escapeHtml(formatLongDateTime(new Date(application.created_at)))}.</p>
            <div class="sps-applied-state">
                <span class="sps-label">Estado actual</span>
                <span class="sps-summary-badge" data-state="${escapeAttr(state.key)}">${escapeHtml(state.label)}</span>
            </div>
            <a class="wo-btn wo-btn--direct wo-btn--block wo-btn--hard" href="/artist/applications?type=spot&id=${encodeURIComponent(application.id)}&from=spots">
                ${state.key === 'contraoferta_recibida' ? 'Responder contraoferta' : 'Ver seguimiento'} <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
            </a>
        `;
        if (window.WoIcons) window.WoIcons.hydrate(aside);
    }

    // "N artistas residentes" — conteo real del roster activo del estudio. El
    // roster público suma guests e itinerantes: se cuentan aparte.
    async function loadRosterCount(s) {
        const studioId = s.studios?.id;
        if (!studioId) return;
        const { data, error } = await WeotziData.StudioMemberships.listActiveRosterWithArtists(studioId);
        if (error || !data || data.length === 0) return;
        const el = document.getElementById('spot-roster');
        if (!el || currentSpot?.id !== s.id) return;
        el.innerHTML = `<i data-wo-icon="users" class="wo-icon-18" aria-hidden="true"></i> ${escapeHtml(rosterCountText(data))}`;
        el.hidden = false;
    }

    function rosterCountText(rows) {
        const guests = rows.filter(row => row && (row.role === 'guest' || row.role === 'itinerant')).length;
        const residents = rows.length - guests;
        const parts = [];
        if (residents) parts.push(`${residents} artista${residents === 1 ? '' : 's'} residente${residents === 1 ? '' : 's'}`);
        if (guests) parts.push(`${guests} guest${guests === 1 ? '' : 's'} e itinerante${guests === 1 ? '' : 's'}`);
        return parts.join(' · ');
    }

    // ============================================
    // CALENDARIO DE FECHAS (aside del ref 06)
    // ============================================

    function startOfDay(d) {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        return x;
    }

    function parseISODate(iso) {
        if (!iso) return null;
        const parts = String(iso).slice(0, 10).split('-').map(Number);
        if (parts.length !== 3 || parts.some(isNaN)) return null;
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    function toISODate(d) {
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
    }

    // Ventana de fechas postulables: dentro del período del spot y nunca en el pasado.
    function calendarWindow(s) {
        const today = startOfDay(new Date());
        const start = parseISODate(s.start_date);
        const end = parseISODate(s.end_date);
        const min = start && start > today ? start : today;
        const max = end || new Date(today.getFullYear(), today.getMonth() + 12, 0);
        return { min, max: max < min ? min : max };
    }

    function resetCalendar(s) {
        selStart = null;
        selEnd = null;
        calCursor = null;
        if (!s) return;
        const win = calendarWindow(s);
        calCursor = new Date(win.min.getFullYear(), win.min.getMonth(), 1);
    }

    function renderCalendar() {
        const host = document.getElementById('spot-cal');
        if (!host || !currentSpot || !calCursor) return;
        const win = calendarWindow(currentSpot);

        const year = calCursor.getFullYear();
        const month = calCursor.getMonth();
        const firstOfMonth = new Date(year, month, 1);
        // Lunes primero: getDay() 0=domingo.
        const lead = (firstOfMonth.getDay() + 6) % 7;
        const gridStart = new Date(year, month, 1 - lead);

        const prevDisabled = new Date(year, month, 0) < win.min;
        const nextDisabled = new Date(year, month + 1, 1) > win.max;

        const cells = [];
        for (let i = 0; i < 42; i += 1) {
            const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
            const outside = day.getMonth() !== month;
            const disabled = day < win.min || day > win.max;
            const isStart = selStart && day.getTime() === selStart.getTime();
            const isEnd = selEnd && day.getTime() === selEnd.getTime();
            const inRange = selStart && selEnd && day > selStart && day < selEnd;
            const classes = ['sps-cal-day'];
            if (outside) classes.push('is-outside');
            if (disabled) classes.push('is-disabled');
            if (isStart || isEnd) classes.push('is-selected');
            if (inRange) classes.push('is-range');
            cells.push(`
                <button type="button" class="${classes.join(' ')}" data-day="${toISODate(day)}" ${disabled ? 'disabled' : ''}>
                    ${day.getDate()}
                </button>
            `);
        }

        host.innerHTML = `
            <div class="sps-cal-head">
                <button type="button" class="sps-cal-nav" data-cal-step="-1" ${prevDisabled ? 'disabled' : ''} aria-label="Mes anterior">
                    <i data-wo-icon="chevron-left" class="wo-icon-18" aria-hidden="true"></i>
                </button>
                <span class="sps-cal-month">${capitalize(MONTHS[month])} ${year}</span>
                <button type="button" class="sps-cal-nav" data-cal-step="1" ${nextDisabled ? 'disabled' : ''} aria-label="Mes siguiente">
                    <i data-wo-icon="chevron-right" class="wo-icon-18" aria-hidden="true"></i>
                </button>
            </div>
            <div class="sps-cal-week">${WEEKDAYS.map(d => `<span>${d}</span>`).join('')}</div>
            <div class="sps-cal-grid">${cells.join('')}</div>
        `;

        host.querySelectorAll('[data-cal-step]').forEach(btn => {
            btn.addEventListener('click', () => {
                calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + Number(btn.dataset.calStep), 1);
                renderCalendar();
            });
        });
        host.querySelectorAll('.sps-cal-day:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => pickDay(parseISODate(btn.dataset.day)));
        });
        paintCalendarSummary();
    }

    function pickDay(day) {
        if (!day) return;
        if (!selStart || selEnd || day < selStart) {
            selStart = day;
            selEnd = null;
        } else {
            selEnd = day;
        }
        renderCalendar();
    }

    function paintCalendarSummary() {
        const el = document.getElementById('spot-cal-summary');
        if (!el) return;
        el.hidden = !selStart;
        if (!selStart) {
            el.textContent = '';
            return;
        }
        el.textContent = selEnd
            ? `Fechas propuestas: ${formatDayMonth(selStart)} – ${formatDayMonth(selEnd)}`
            : `Inicio ${formatDayMonth(selStart)} · elegí el día de cierre.`;
    }

    function selectedRange() {
        if (!selStart) return null;
        const endExclusive = new Date((selEnd || selStart).getTime() + DAY_MS);
        return `[${toISODate(selStart)},${toISODate(endExclusive)})`;
    }

    function selectedRangeLabel() {
        if (!selStart) return 'A convenir con el estudio';
        return formatShortRange(selStart, selEnd || selStart);
    }

    // ============================================
    // POSTULACIÓN
    // ============================================

    function wireApply(s) {
        const btn = document.getElementById('apply-submit');
        if (!btn || !artist || !session) return;

        btn.addEventListener('click', async () => {
            const statusEl = document.getElementById('apply-status');
            btn.disabled = true;
            btn.textContent = 'Enviando…';

            const { data: existing } = await WeotziData.StudioSpots.getApplication(s.id, session.user.id);
            if (existing) {
                showApplyError(statusEl, btn, 'Ya te postulaste a este spot. Estado: ' + rawStatusLabel(existing.status).toLowerCase() + '.');
                markAlreadyApplied(s);
                return;
            }

            const { error } = await WeotziData.StudioSpots.createApplication({
                spotId: s.id,
                artistUserId: session.user.id,
                message: (document.getElementById('apply-message')?.value || '').trim() || null,
                portfolioUrl: artist.portafolio || null,
                requestedDates: selectedRange()
            });

            if (error) {
                showApplyError(statusEl, btn, error.message);
                return;
            }
            renderSent(s);
        });
    }

    function showApplyError(statusEl, btn, message) {
        btn.disabled = false;
        btn.innerHTML = 'Enviar solicitud <i data-wo-icon="send" class="wo-icon-18" aria-hidden="true"></i>';
        if (!statusEl) return;
        statusEl.className = 'wo-alert wo-alert--error';
        statusEl.textContent = message;
        statusEl.hidden = false;
    }

    // ============================================
    // SOLICITUD ENVIADA (ref 07)
    // ============================================

    function renderSent(s, application, state) {
        const view = document.getElementById('spot-sent-view');
        if (!view) return;
        const sentRange = application ? parseDaterange(application.requested_dates) : null;
        const rangeLabel = application
            ? (sentRange ? formatShortRange(sentRange.start, sentRange.end) : 'A convenir con el estudio')
            : selectedRangeLabel();
        const sentAt = application?.created_at ? new Date(application.created_at) : new Date();

        const initials = String(spotName(s)).split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase();
        const rows = [
            ['Estudio', `<span class="sps-sum-studio"><span class="sps-sum-initials" aria-hidden="true">${escapeHtml(initials)}</span>${escapeHtml(spotName(s))}</span>`, true],
            ['Ciudad', escapeHtml(cityCountryOf(s) || 'A confirmar'), false],
            ['Tipo de spot', `<span class="sps-summary-kind">${escapeHtml(KIND_LABELS[s.kind] || s.kind)}</span>`, false],
            ['Fechas propuestas', escapeHtml(rangeLabel), false],
            ['Split / condiciones', '<span class="sps-summary-mono">' + escapeHtml(conditionsText(s) || 'A convenir') + '</span>', false],
            ['Fecha de envío', escapeHtml(formatLongDateTime(sentAt)), false]
        ];

        view.innerHTML = `
            <div class="sps-sent-tile" aria-hidden="true"><i data-wo-icon="check" aria-hidden="true"></i></div>
            <span class="wo-eyebrow">Spots / Solicitud enviada</span>
            <h1 class="sps-sent-title">¡Solicitud enviada con éxito!</h1>
            <p class="sps-sent-sub">
                ${escapeHtml(spotName(s))} va a revisar tu solicitud. Puede aceptarla tal cual o enviarte una
                contraoferta con cambios en fechas o condiciones — te avisamos apenas responda.
            </p>

            <div class="sps-summary">
                <div class="sps-summary-head">
                    <span class="wo-meta-s">Resumen del spot</span>
                    <span class="sps-summary-badge"${state ? ` data-state="${escapeAttr(state.key)}"` : ''}>${escapeHtml(state ? state.label : 'En revisión')}</span>
                </div>
                <div class="sps-summary-body">
                    ${rows.map(([k, v]) => `
                        <div class="sps-summary-row">
                            <span class="sps-summary-key">${escapeHtml(k)}</span>
                            <span class="sps-summary-val">${v}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="sps-sent-actions">
                <a href="/artist/applications?tab=spots" class="wo-btn wo-btn--direct wo-btn--hard">
                    Ver mis postulaciones <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
                </a>
                <button type="button" class="wo-btn wo-btn--secondary wo-btn--hard" id="spot-keep-browsing">Seguir explorando spots</button>
            </div>
        `;

        document.getElementById('spot-keep-browsing')?.addEventListener('click', backToDirectory);
        currentSpot = null;
        syncUrl(null, false);
        showView('sent');
    }

    // -------- helpers --------
    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(v) { return escapeHtml(v); }
    // URL dentro de style="…url('…')": comillas y barras se codifican en la URL
    // (las barras invertidas no escapan en HTML) y el resto se escapa para el
    // atributo, así una URL de datos no puede cerrar el atributo.
    function cssEscape(v) {
        return escapeAttr(String(v == null ? '' : v).replace(/\\/g, '%5C').replace(/'/g, '%27').replace(/"/g, '%22'));
    }
    // href externo de datos: solo http(s); un dominio sin protocolo
    // ("estudio.com") se completa con https://. Si no, ''.
    function safeHref(value) {
        let raw = String(value == null ? '' : value).trim();
        if (!raw) return '';
        if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(raw)) raw = 'https://' + raw;
        try {
            const url = new URL(raw);
            return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname ? url.href : '';
        } catch (err) {
            return '';
        }
    }
    function capitalize(v) { return String(v).charAt(0).toUpperCase() + String(v).slice(1); }
    function normalizeList(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            try {
                if (value.trim().startsWith('[')) return JSON.parse(value);
            } catch (err) { /* cae al split */ }
            return value.split(',').map(v => v.trim()).filter(Boolean);
        }
        return [];
    }
    function truncate(text, maxLen) {
        const t = String(text || '');
        if (t.length <= maxLen) return t;
        return t.substring(0, maxLen).trimEnd() + '…';
    }
    function formatMoney(value) {
        return Number(value).toLocaleString('es-AR');
    }
    // Literal DATERANGE '[inicio,fin)' → fechas inclusivas.
    function parseDaterange(raw) {
        const m = String(raw || '').match(/^[\[(]\s*(\d{4}-\d{2}-\d{2})\s*,\s*(\d{4}-\d{2}-\d{2})\s*([\])])$/);
        if (!m) return null;
        const start = parseISODate(m[1]);
        let end = parseISODate(m[2]);
        if (m[3] === ')') end = new Date(end.getTime() - DAY_MS);
        return start && end ? { start, end } : null;
    }
    // "1 – 15 de septiembre" o "28 de septiembre – 5 de octubre".
    function formatShortRange(start, end) {
        if (!end || start.getTime() === end.getTime()) return formatDayMonth(start);
        if (start.getMonth() === end.getMonth()) return `${start.getDate()} – ${end.getDate()} de ${MONTHS[end.getMonth()]}`;
        return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
    }
    function formatDayMonth(date) {
        return `${date.getDate()} de ${MONTHS[date.getMonth()]}`;
    }
    function formatLongDateTime(date) {
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return `${date.getDate()} de ${MONTHS[date.getMonth()]}, ${date.getFullYear()} · ${hh}:${mm}`;
    }
    function formatDateRange(start, end) {
        const s = parseISODate(start);
        if (!s) return '';
        if (!end) return `Desde el ${formatDayMonth(s)}`;
        const e = parseISODate(end);
        if (!e) return `Desde el ${formatDayMonth(s)}`;
        return `${formatDayMonth(s)} – ${formatDayMonth(e)} de ${e.getFullYear()}`;
    }
})();
