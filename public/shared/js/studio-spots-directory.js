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
    const RIBBON_SLOTS = 4;
    const MOSAIC_SLOTS = 6;
    const MOBILE_MENU_BREAKPOINT = 768;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    let spots = [];
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
        }
        paintTopbarAuth();
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
        const { data, error } = await WeotziData.StudioSpots.listOpenWithStudioAndLocation();

        if (error) {
            document.getElementById('spots-mosaic').innerHTML =
                '<div class="wo-alert wo-alert--error">No pudimos cargar los spots: ' + escapeHtml(error.message) + '</div>';
            return;
        }
        spots = data || [];
        renderDirectory();
        openFromQuery({ push: false });
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
        return s.revenue_split_pct == null ? '' : `Split ${Number(s.revenue_split_pct).toFixed(0)}%`;
    }

    function stipendText(s) {
        if (!s.stipend_amount) return '';
        return `Stipend ${formatMoney(s.stipend_amount)} ${s.stipend_currency || ''}`.trim();
    }

    // Línea mono del Figma: "3 a 6 meses · Split 66% · Stipend 1.000 EUR".
    function metaLine(s) {
        return [durationText(s), splitText(s), stipendText(s), closingText(s)]
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

    function markHtml(kind) {
        return `<span class="sps-mark sps-mark--${escapeAttr(kind)}" aria-hidden="true"></span>`;
    }

    function descriptionOf(s) {
        const studio = s.studios || {};
        return s.description || studio.tagline || studio.bio || '';
    }

    function photosOf(s) {
        const studio = s.studios || {};
        const feed = Array.isArray(studio.photo_feed_items) ? studio.photo_feed_items : [];
        const urls = [
            s.cover_image,
            ...feed.map(p => (p && typeof p === 'object' ? p.url : p)),
            studio.cover_image
        ].filter(u => typeof u === 'string' && u);
        return [...new Set(urls)].slice(0, 4);
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
        const spot = spots.find(x => x.id === id);
        if (!spot) { showView('feed'); return; }
        openDetail(spot, { push: options.push === true });
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
            emptyEl.classList.remove('hidden');
            return;
        }
        emptyEl.classList.add('hidden');

        const [feature, ...rest] = spots;
        featureEl.innerHTML = renderFeature(feature);
        mosaicEl.innerHTML = rest.slice(0, MOSAIC_SLOTS).map((s, i) => renderTile(s, i)).join('');
        ribbonEl.innerHTML = renderRibbon();

        document.querySelectorAll('[data-spot-open]').forEach(el => {
            el.addEventListener('click', (event) => {
                event.preventDefault();
                const spot = spots.find(x => x.id === el.dataset.spotOpen);
                if (spot) openDetail(spot);
            });
        });
    }

    // Franja destacada de ancho completo: el spot publicado más recientemente.
    function renderFeature(s) {
        const cover = photosOf(s)[0] || '';
        const city = cityOf(s);
        const eyebrow = [KIND_LABELS[s.kind] || s.kind, city].filter(Boolean).join(' · ');
        const desc = descriptionOf(s);

        return `
            <article class="sps-feature">
                <div class="sps-feature-media" ${cover ? `style="background-image:url('${cssEscape(cover)}')"` : ''} aria-hidden="true"></div>
                <div class="sps-feature-body">
                    <span class="sps-feature-eyebrow">${escapeHtml(eyebrow)}</span>
                    <h2 class="sps-feature-title">${escapeHtml(spotName(s))}</h2>
                    ${metaLine(s) ? `<span class="sps-feature-meta">${escapeHtml(metaLine(s))}</span>` : ''}
                    ${styleChips(s, 3) ? `<div class="sps-styles">${styleChips(s, 3)}</div>` : ''}
                    ${desc ? `<p class="sps-feature-desc">${escapeHtml(truncate(desc, 190))}</p>` : ''}
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
    function renderTile(s, index) {
        const close = daysToClose(s);
        const urgent = close !== null && close <= 2;
        const large = index < 2;
        const city = cityOf(s);
        const eyebrow = [KIND_LABELS[s.kind] || s.kind, city].filter(Boolean).join(' · ');

        let variant = large ? (index === 0 ? 'sps-tile--paper' : 'sps-tile--sand') : 'sps-tile--paper';
        if (!large) {
            if (urgent) variant = 'sps-tile--urgent';
            else if (index % 2 === 1) variant = 'sps-tile--cream';
        }

        if (large) {
            const desc = descriptionOf(s);
            return `
                <article class="sps-tile sps-tile--large ${variant}" data-spot-open="${escapeAttr(s.id)}">
                    <span class="sps-tile-top">${markHtml(s.kind)}<span class="sps-tile-city">${escapeHtml(eyebrow)}</span></span>
                    <h3 class="sps-tile-name">${escapeHtml(spotName(s))}</h3>
                    ${metaLine(s) ? `<span class="sps-tile-meta">${escapeHtml(metaLine(s))}</span>` : ''}
                    ${styleChips(s, 3) ? `<div class="sps-styles">${styleChips(s, 3)}</div>` : ''}
                    ${desc ? `<p class="sps-tile-desc">${escapeHtml(truncate(desc, 150))}</p>` : ''}
                    <span class="wo-btn wo-btn--direct sps-tile-cta">
                        Postularme <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
                    </span>
                </article>
            `;
        }

        return `
            <article class="sps-tile ${variant}" data-spot-open="${escapeAttr(s.id)}">
                ${urgent ? '<span class="sps-tile-urgency">Última oportunidad</span>' : ''}
                <span class="sps-tile-top">${markHtml(s.kind)}<span class="sps-tile-city">${escapeHtml(city || KIND_LABELS[s.kind] || '')}</span></span>
                <h3 class="sps-tile-name">${escapeHtml(spotName(s))}</h3>
                ${metaLine(s) ? `<span class="sps-tile-meta">${escapeHtml(metaLine(s))}</span>` : ''}
            </article>
        `;
    }

    // Cinta inferior: los spots con cierre más próximo.
    function renderRibbon() {
        const closing = spots
            .filter(s => daysToClose(s) !== null)
            .sort((a, b) => daysToClose(a) - daysToClose(b))
            .slice(0, RIBBON_SLOTS);
        if (closing.length === 0) return '';

        return closing.map(s => `
            <a class="sps-ribbon-cell" href="?spot=${encodeURIComponent(s.id)}" data-spot-open="${escapeAttr(s.id)}">
                ${markHtml(s.kind)}
                <span>${escapeHtml([spotName(s), cityOf(s), closingText(s)].filter(Boolean).join(' · '))}</span>
            </a>
        `).join('');
    }

    // ============================================
    // DETALLE DEL SPOT (ref 06)
    // ============================================

    function includesList(s) {
        const items = [];
        // Solo hechos reales del spot; el Figma tiene una lista editorial libre que
        // no existe como columna (ver informe: requiere backend nuevo).
        if (s.includes_housing) items.push('Alojamiento incluido durante el spot');
        if (s.stipend_amount) items.push(`Stipend de ${formatMoney(s.stipend_amount)} ${s.stipend_currency || ''}`.trim());
        return items;
    }

    function requirementsList(s) {
        const items = [];
        if (s.experience_min_years) items.push(`Mínimo ${s.experience_min_years} año${s.experience_min_years === 1 ? '' : 's'} de experiencia profesional`);
        if ((s.styles_wanted || []).length) items.push(`Portfolio con foco en ${s.styles_wanted.join(', ')}`);
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
        if (s.start_date) cells.push(['Fechas disponibles', formatDateRange(s.start_date, s.end_date)]);
        if (durationText(s)) cells.push(['Duración', durationText(s)]);
        if (s.revenue_split_pct != null) cells.push(['Split / comisión', `${Number(s.revenue_split_pct).toFixed(0)}% para el artista`]);
        if (s.stipend_amount) cells.push(['Stipend', `${formatMoney(s.stipend_amount)} ${s.stipend_currency || ''}`.trim()]);
        if (s.max_applications) cells.push(['Postulaciones', `${s.application_count || 0} de ${s.max_applications}`]);
        return cells;
    }

    function buildDetailMain(s) {
        const studio = s.studios || {};
        const photos = photosOf(s);
        const cells = detailCells(s);
        const desc = descriptionOf(s);

        return `
            <button type="button" class="sps-back" id="spot-back">
                <i data-wo-icon="arrow-left" class="wo-icon-18" aria-hidden="true"></i> Volver a spots
            </button>

            ${cityCountryOf(s) ? `
                <span class="sps-detail-place">
                    <i data-wo-icon="map-pin" class="wo-icon-18" aria-hidden="true"></i> ${escapeHtml(cityCountryOf(s))}
                </span>
            ` : ''}
            <h1 class="sps-detail-title">${escapeHtml(spotName(s))}</h1>

            ${photos.length ? `
                <div class="sps-gallery">
                    ${photos.map(u => `<span class="sps-gallery-item" style="background-image:url('${cssEscape(u)}')" role="img" aria-label="Foto del estudio"></span>`).join('')}
                </div>
            ` : ''}

            ${desc ? `<p class="sps-detail-desc">${escapeHtml(desc)}</p>` : ''}

            <div class="sps-links" id="spot-links">
                ${studio.instagram ? `<a href="https://instagram.com/${encodeURIComponent(String(studio.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener"><i data-wo-icon="instagram" class="wo-icon-18" aria-hidden="true"></i> @${escapeHtml(String(studio.instagram).replace(/^@/, ''))}</a>` : ''}
                ${studio.website ? `<a href="${escapeAttr(studio.website)}" target="_blank" rel="noopener"><i data-wo-icon="globe" class="wo-icon-18" aria-hidden="true"></i> ${escapeHtml(String(studio.website).replace(/^https?:\/\//, ''))}</a>` : ''}
                <span id="spot-roster" hidden></span>
            </div>

            <div class="sps-detail-chips">
                ${styleChips(s, 6)}
                <span class="sps-kind-badge">${escapeHtml(KIND_LABELS[s.kind] || s.kind)}</span>
            </div>

            ${cells.length ? `
                <span class="sps-label">Detalles de la oportunidad</span>
                <div class="sps-meta-grid">
                    ${cells.map(([k, v]) => `
                        <div class="sps-meta-row">
                            <span class="sps-meta-key">${escapeHtml(k)}</span>
                            <span class="sps-meta-val">${escapeHtml(v)}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <div class="sps-bullet-cols">
                ${bulletList('Qué incluye el estudio', includesList(s))}
                ${bulletList('Requisitos mínimos', requirementsList(s))}
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

        return `
            <div class="sps-preview">
                <span class="sps-label">Portfolio</span>
                <div class="sps-preview-id">
                    <span class="wo-avatar wo-avatar--s">${artist.profile_picture ? `<img src="${escapeAttr(artist.profile_picture)}" alt="">` : escapeHtml(initial)}</span>
                    <div>
                        <span class="sps-preview-name">${escapeHtml(name)}</span>
                        ${city ? `<span class="sps-preview-city">${escapeHtml(city)}</span>` : ''}
                    </div>
                </div>
                ${styles.length ? `<div class="sps-styles">${styles.map(st => `<span class="sps-tag">${escapeHtml(st)}</span>`).join('')}</div>` : ''}
                ${shots.length ? `<div class="sps-preview-shots">${shots.map(u => `<img src="${escapeAttr(u)}" alt="" loading="lazy">`).join('')}</div>` : ''}
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
            <p class="sps-cal-summary" id="spot-cal-summary">Elegí el día de inicio y el de cierre.</p>

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
    }

    // "N artistas residentes" — conteo real del roster activo del estudio.
    async function loadRosterCount(s) {
        const studioId = s.studios?.id;
        if (!studioId) return;
        const { data, error } = await WeotziData.StudioMemberships.listActiveRosterWithArtists(studioId);
        if (error || !data || data.length === 0) return;
        const el = document.getElementById('spot-roster');
        if (!el || currentSpot?.id !== s.id) return;
        el.innerHTML = `<i data-wo-icon="users" class="wo-icon-18" aria-hidden="true"></i> ${data.length} artista${data.length === 1 ? '' : 's'} residente${data.length === 1 ? '' : 's'}`;
        el.hidden = false;
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
        if (!selStart) {
            el.textContent = 'Elegí el día de inicio y el de cierre.';
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
        return selEnd ? `${formatDayMonth(selStart)} – ${formatDayMonth(selEnd)}` : formatDayMonth(selStart);
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
                showApplyError(statusEl, btn, 'Ya te postulaste a este spot. Estado: ' + existing.status + '.');
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

    function renderSent(s) {
        const view = document.getElementById('spot-sent-view');
        if (!view) return;

        const initials = String(spotName(s)).split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase();
        const rows = [
            ['Estudio', `<span class="sps-sum-studio"><span class="wo-avatar wo-avatar--s">${escapeHtml(initials)}</span>${escapeHtml(spotName(s))}</span>`, true],
            ['Ciudad', escapeHtml(cityCountryOf(s) || 'A confirmar'), false],
            ['Tipo de spot', escapeHtml(KIND_LABELS[s.kind] || s.kind), false],
            ['Fechas propuestas', escapeHtml(selectedRangeLabel()), false],
            ['Split / condiciones', escapeHtml([splitText(s) ? `${Number(s.revenue_split_pct).toFixed(0)}% para el artista` : '', stipendText(s)].filter(Boolean).join(' · ') || 'A convenir'), false],
            ['Fecha de envío', escapeHtml(formatLongDateTime(new Date())), false]
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
                    <span class="sps-summary-badge">En revisión</span>
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
    function cssEscape(v) { return String(v).replace(/'/g, "\\'").replace(/"/g, '\\"'); }
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
