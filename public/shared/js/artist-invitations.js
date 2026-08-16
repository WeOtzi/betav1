// ============================================
// Invitaciones del artista (DS Bauhaus) — refs Figma 08 · 09
// 08: hero con resumen dinámico + índice de estudios, barra de control
//     (tabs / orden / buscador / leyenda / mapa), invitación destacada,
//     membresías activas como card azul, filas pendientes y filas rechazadas.
// 09: detalle de la invitación (stepper, estudio, condiciones, mensaje) con
//     aside de resumen y acciones.
// Datos: studio_artist_memberships vía WeotziData.StudioMemberships
//        (pending_acceptance → active | rejected).
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;

    const ROLE_LABELS = { resident: 'Residente', itinerant: 'Itinerante', guest: 'Guest', manager: 'Manager' };
    const ROLE_BADGES = { resident: 'Roster', itinerant: 'Itinerante', guest: 'Guest', manager: 'Manager' };
    const STATE_LABELS = { pending: 'Pendiente', active: 'Aceptada', rejected: 'Rechazada' };
    const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const MOBILE_MENU_BREAKPOINT = 768;

    let userId = null;
    let items = [];
    let activeTab = 'all';
    let sortMode = 'recent';
    let searchTerm = '';
    let currentItem = null;

    document.addEventListener('DOMContentLoaded', async () => {
        setupMobileMenu();
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) {
            window.location.href = '/artist/login?returnTo=' + encodeURIComponent('/artist/invitations');
            return;
        }
        userId = session.user.id;
        document.getElementById('auth-logout')?.classList.remove('hidden');
        wireLogout();
        wireControls();
        window.addEventListener('popstate', () => openFromQuery({ push: false }));
        await load();
    });

    // ============================================
    // TOPBAR
    // ============================================

    function wireLogout() {
        const btn = document.getElementById('auth-logout');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            try { await _supabase.auth.signOut(); } catch (err) { console.warn('[invitaciones] logout:', err); }
            window.location.href = '/artist/login?returnTo=%2Fartist%2Finvitations';
        });
    }

    function setupMobileMenu() {
        const toggle = document.getElementById('inv-mobile-menu-toggle');
        const menu = document.getElementById('inv-mobile-menu');
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

    async function load() {
        const repo = WeotziData.StudioMemberships;
        const [pending, active, rejected] = await Promise.all([
            repo.listPendingForArtist(userId),
            repo.listActiveForArtist(userId),
            typeof repo.listRejectedForArtist === 'function'
                ? repo.listRejectedForArtist(userId)
                : Promise.resolve({ data: [], error: null })
        ]);

        const firstError = pending.error || active.error || rejected.error;
        if (firstError) {
            document.getElementById('invitations-list').innerHTML =
                '<div class="wo-alert wo-alert--error">' + escapeHtml(firstError.message) + '</div>';
            return;
        }

        items = [
            ...(pending.data || []).map(m => ({ ...m, _state: 'pending' })),
            ...(active.data || []).map(m => ({ ...m, _state: 'active' })),
            ...(rejected.data || []).map(m => ({ ...m, _state: 'rejected' }))
        ];

        renderHero();
        renderIndex();
        renderList();
        openFromQuery({ push: false });
    }

    function countBy(state) {
        return items.filter(m => m._state === state).length;
    }

    // Fecha que define el estado actual de la fila: cuándo te invitaron, cuándo
    // entraste al roster o cuándo se cerró.
    function eventDate(m) {
        if (m._state === 'active') return m.started_at || m.invited_at || null;
        if (m._state === 'rejected') return m.ended_at || m.invited_at || null;
        return m.invited_at || m.started_at || null;
    }

    function studioOf(m) { return m.studios || {}; }
    function studioName(m) { return studioOf(m).name || 'Estudio'; }

    function locationText(m) {
        const loc = m.location || {};
        const cityCountry = [loc.city, loc.country].filter(Boolean).join(', ');
        return cityCountry || loc.label || '';
    }

    function cityOf(m) {
        const loc = m.location || {};
        return loc.city || loc.label || '';
    }

    // Línea mono bajo el nombre del estudio: ciudad + rol propuesto (datos reales
    // de la membership; el estudio no guarda estilos propios).
    function metaLine(m) {
        const role = ROLE_LABELS[m.role] || m.role;
        const verb = m._state === 'active' ? 'Sos' : 'Te invitan como';
        return [locationText(m), `${verb} ${role}`].filter(Boolean).join(' · ');
    }

    // Condiciones económicas reales: revenue_split_pct → "60/40 comisión".
    function termsLine(m) {
        if (m.revenue_split_pct == null) return '';
        const artistPct = Math.round(Number(m.revenue_split_pct));
        return `${artistPct}/${100 - artistPct} comisión`;
    }

    // ============================================
    // HERO (ref 08)
    // ============================================

    function renderHero() {
        const now = new Date();
        const eyebrow = document.getElementById('inv-eyebrow');
        if (eyebrow) eyebrow.textContent = `Invitaciones · Edición ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

        const countEl = document.getElementById('inv-count');
        if (countEl) countEl.textContent = String(countBy('pending')).padStart(2, '0');

        const subEl = document.getElementById('inv-sub');
        if (subEl) subEl.textContent = summarySentence();
    }

    // "3 esperan tu respuesta, 1 ya es tu casa y 1 quedó en el camino."
    function summarySentence() {
        const p = countBy('pending');
        const a = countBy('active');
        const r = countBy('rejected');
        const parts = [];
        if (p) parts.push(`${p} ${p === 1 ? 'espera' : 'esperan'} tu respuesta`);
        if (a) parts.push(`${a} ya ${a === 1 ? 'es tu casa' : 'son tu casa'}`);
        if (r) parts.push(`${r} ${r === 1 ? 'quedó' : 'quedaron'} en el camino`);
        if (parts.length === 0) return 'Todavía no recibiste invitaciones de estudios.';
        if (parts.length === 1) return parts[0] + '.';
        return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}.`;
    }

    // ============================================
    // ÍNDICE LATERAL (ref 08)
    // ============================================

    function renderIndex() {
        const nav = document.getElementById('inv-index');
        if (!nav) return;
        const ordered = [...items].sort((a, b) => new Date(eventDate(b) || 0) - new Date(eventDate(a) || 0));
        if (ordered.length === 0) { nav.innerHTML = ''; return; }

        nav.innerHTML = ordered.map((m, i) => `
            <button type="button" class="inv-index-item" data-open="${escapeAttr(m.id)}">
                <span class="inv-index-name">
                    <i class="inv-dot inv-dot--${escapeAttr(m._state)}" aria-hidden="true"></i>
                    <span>${String(i + 1).padStart(2, '0')} ${escapeHtml(studioName(m))}</span>
                </span>
                <span class="inv-index-city">${escapeHtml(cityOf(m))}</span>
            </button>
        `).join('');

        nav.querySelectorAll('[data-open]').forEach(btn => {
            btn.addEventListener('click', () => openDetailById(btn.dataset.open));
        });
    }

    // ============================================
    // BARRA DE CONTROL (ref 08)
    // ============================================

    function wireControls() {
        document.querySelectorAll('#inv-tabs [data-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.tab;
                document.querySelectorAll('#inv-tabs [data-tab]').forEach(b => {
                    const on = b === btn;
                    b.classList.toggle('is-active', on);
                    b.setAttribute('aria-selected', String(on));
                });
                renderList();
            });
        });

        document.getElementById('inv-sort')?.addEventListener('change', (e) => {
            sortMode = e.target.value;
            renderList();
        });

        document.getElementById('inv-search')?.addEventListener('input', (e) => {
            searchTerm = e.target.value.trim().toLowerCase();
            renderList();
        });
    }

    function visibleItems() {
        let list = items.filter(m => activeTab === 'all' || m._state === activeTab);

        if (searchTerm) {
            list = list.filter(m =>
                studioName(m).toLowerCase().includes(searchTerm) ||
                locationText(m).toLowerCase().includes(searchTerm)
            );
        }

        const byDate = (dir) => (a, b) => dir * (new Date(eventDate(a) || 0) - new Date(eventDate(b) || 0));
        if (sortMode === 'oldest') list.sort(byDate(1));
        else if (sortMode === 'studio') list.sort((a, b) => studioName(a).localeCompare(studioName(b)));
        else list.sort(byDate(-1));

        return list;
    }

    // ============================================
    // LISTADO (ref 08)
    // ============================================

    function renderList() {
        const list = document.getElementById('invitations-list');
        if (!list) return;
        const visible = visibleItems();

        if (visible.length === 0) {
            list.innerHTML = `
                <div class="wo-empty">
                    <i data-wo-icon="mail" aria-hidden="true"></i>
                    <span class="wo-empty-title">No hay invitaciones para mostrar</span>
                    <p>Cuando un estudio te quiera en su roster, la invitación va a aparecer acá.</p>
                </div>
            `;
            return;
        }

        const pending = visible.filter(m => m._state === 'pending');
        const active = visible.filter(m => m._state === 'active');
        const rejected = visible.filter(m => m._state === 'rejected');
        const [feature, ...restPending] = pending;

        list.innerHTML = [
            feature ? renderFeature(feature) : '',
            ...active.map(renderMember),
            ...restPending.map(renderRow),
            ...rejected.map(renderRejected)
        ].join('');

        list.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                const { action, id } = btn.dataset;
                if (action === 'open') openDetailById(id);
                else if (action === 'leave') leave(id);
                else decide(action, id);
            });
        });
    }

    function renderFeature(m) {
        const s = studioOf(m);
        const cover = s.cover_image || s.logo_image || '';
        const terms = termsLine(m);

        return `
            <article class="inv-feature" data-id="${escapeAttr(m.id)}">
                <div class="inv-feature-body">
                    <div class="inv-feature-top">
                        <span class="inv-feature-eyebrow">Invitación del mes${eventDate(m) ? ' · ' + escapeHtml(shortDate(eventDate(m))) : ''}</span>
                        <span class="inv-badge inv-badge--accent">Pendiente</span>
                    </div>
                    <h2 class="inv-feature-name">${escapeHtml(studioName(m))}</h2>
                    <span class="inv-feature-meta">${escapeHtml(metaLine(m))}</span>
                    ${m.notes ? `<p class="inv-quote">“${escapeHtml(m.notes)}”</p>` : ''}
                    ${terms ? `<span class="inv-terms">${escapeHtml(terms)}</span>` : ''}
                    <div class="inv-feature-actions">
                        <button class="wo-btn wo-btn--accent wo-btn--hard" data-action="accept" data-id="${escapeAttr(m.id)}">
                            Aceptar <i data-wo-icon="check" class="wo-icon-18" aria-hidden="true"></i>
                        </button>
                        <button class="wo-btn inv-btn-ghost-dark" data-action="reject" data-id="${escapeAttr(m.id)}">Rechazar</button>
                        <button type="button" class="inv-link-dark" data-action="open" data-id="${escapeAttr(m.id)}">Ver invitación →</button>
                        ${studioLinkHtml(s, 'inv-link-dark')}
                    </div>
                </div>
                <div class="inv-feature-media" ${cover ? `style="background-image:url('${cssEscape(cover)}')"` : ''} aria-hidden="true"></div>
            </article>
        `;
    }

    // Membresía activa: card azul editorial (reemplaza la tabla vieja).
    function renderMember(m) {
        const s = studioOf(m);
        return `
            <article class="inv-member" data-id="${escapeAttr(m.id)}">
                <div>
                    <span class="inv-member-eyebrow">Miembro del roster${eventDate(m) ? ' · ' + escapeHtml(shortDate(eventDate(m))) : ''}</span>
                    <h3 class="inv-member-name">${escapeHtml(studioName(m))}</h3>
                    <span class="inv-member-meta">${escapeHtml(metaLine(m))}</span>
                </div>
                <div class="inv-member-side">
                    ${m.notes ? `<p class="inv-member-quote">“${escapeHtml(m.notes)}”</p>` : ''}
                    <div class="inv-member-actions">
                        ${studioLinkHtml(s, 'inv-link-on-blue')}
                        <button type="button" class="inv-link-on-blue" data-action="leave" data-id="${escapeAttr(m.id)}">Salir del roster</button>
                    </div>
                </div>
            </article>
        `;
    }

    function renderRow(m) {
        return `
            <article class="inv-row" data-id="${escapeAttr(m.id)}">
                <span class="inv-row-date">${escapeHtml(shortDate(eventDate(m))) || '—'}</span>
                <div class="inv-row-main">
                    <h3 class="inv-row-name">${escapeHtml(studioName(m))}</h3>
                    <div class="inv-row-meta">${escapeHtml(metaLine(m))}${termsLine(m) ? ' · ' + escapeHtml(termsLine(m)) : ''}</div>
                    ${m.notes ? `<p class="inv-row-quote">“${escapeHtml(m.notes)}”</p>` : ''}
                </div>
                <span class="inv-badge inv-badge--pending inv-row-badge">Pendiente</span>
                <div class="inv-row-actions">
                    <button class="wo-btn wo-btn--s" data-action="accept" data-id="${escapeAttr(m.id)}">Aceptar</button>
                    <button class="wo-btn wo-btn--secondary wo-btn--s" data-action="reject" data-id="${escapeAttr(m.id)}">Rechazar</button>
                    <button type="button" class="inv-link" data-action="open" data-id="${escapeAttr(m.id)}">Ver invitación →</button>
                </div>
            </article>
        `;
    }

    function renderRejected(m) {
        const s = studioOf(m);
        const initials = studioName(m).split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase();
        const meta = [locationText(m), ROLE_LABELS[m.role] || m.role, shortDate(eventDate(m))].filter(Boolean).join(' · ');

        return `
            <article class="inv-rejected" data-id="${escapeAttr(m.id)}">
                <div class="inv-rejected-id">
                    <span class="inv-rejected-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
                    <div>
                        <span class="inv-rejected-name">${escapeHtml(studioName(m))}</span>
                        <span class="inv-rejected-meta">${escapeHtml(meta)}</span>
                    </div>
                </div>
                <div class="inv-rejected-side">
                    <span class="inv-badge inv-badge--rejected">Rechazada</span>
                    ${studioLinkHtml(s, 'inv-link inv-link--faint')}
                </div>
            </article>
        `;
    }

    function studioLinkHtml(s, className) {
        if (!s.slug) return '';
        return `<a class="${className}" href="/studio/profile/?studio=${encodeURIComponent(s.slug)}" target="_blank" rel="noopener">Ver estudio →</a>`;
    }

    // ============================================
    // DETALLE (ref 09)
    // ============================================

    function showView(name) {
        document.getElementById('inv-feed-view')?.classList.toggle('hidden', name !== 'feed');
        document.getElementById('inv-detail-view')?.classList.toggle('hidden', name !== 'detail');
        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function syncUrl(item, push) {
        if (!window.history?.pushState) return;
        const url = new URL(window.location.href);
        if (item) url.searchParams.set('invitacion', item.id);
        else url.searchParams.delete('invitacion');
        if (push) window.history.pushState(null, '', url);
        else window.history.replaceState(null, '', url);
    }

    function openFromQuery(options = {}) {
        const id = new URLSearchParams(window.location.search).get('invitacion');
        if (!id) { currentItem = null; showView('feed'); return; }
        const item = items.find(m => m.id === id);
        if (!item) { showView('feed'); return; }
        openDetail(item, { push: options.push === true });
    }

    function openDetailById(id) {
        const item = items.find(m => m.id === id);
        if (item) openDetail(item);
    }

    function backToList() {
        currentItem = null;
        syncUrl(null, true);
        showView('feed');
    }

    function stepperHtml(state) {
        const steps = [
            { n: 1, label: 'Invitación recibida' },
            { n: 2, label: 'En revisión' },
            { n: 3, label: 'Respondida' },
            { n: 4, label: 'Confirmada' }
        ];
        const reached = state === 'active' ? 4 : state === 'rejected' ? 3 : 2;
        return `
            <div class="wo-stepper inv-stepper">
                ${steps.map((s, i) => `
                    ${i > 0 ? '<span class="wo-step-line" aria-hidden="true"></span>' : ''}
                    <span class="wo-step ${s.n < reached ? 'is-done' : s.n === reached ? 'is-active' : ''}">
                        <span class="dot">${s.n}</span> ${escapeHtml(s.label)}
                    </span>
                `).join('')}
            </div>
        `;
    }

    function detailCells(m) {
        const cells = [];
        cells.push(['Rol propuesto', ROLE_LABELS[m.role] || m.role]);
        if (m.revenue_split_pct != null) {
            cells.push(['Split para vos', `${Math.round(Number(m.revenue_split_pct))}% para el artista`]);
        }
        if (locationText(m)) cells.push(['Sede', locationText(m)]);
        if (m.invited_at) cells.push(['Invitación recibida', longDate(m.invited_at)]);
        if (m._state === 'active' && m.started_at) cells.push(['Miembro desde', longDate(m.started_at)]);
        return cells;
    }

    function photosOf(m) {
        const s = studioOf(m);
        const feed = Array.isArray(s.photo_feed_items) ? s.photo_feed_items : [];
        const urls = [s.cover_image, ...feed.map(p => (p && typeof p === 'object' ? p.url : p)), s.logo_image]
            .filter(u => typeof u === 'string' && u);
        return [...new Set(urls)].slice(0, 4);
    }

    function buildDetailMain(m) {
        const s = studioOf(m);
        const photos = photosOf(m);
        const cells = detailCells(m);
        const desc = s.bio || s.tagline || '';

        return `
            <button type="button" class="sps-back" id="inv-back">
                <i data-wo-icon="arrow-left" class="wo-icon-18" aria-hidden="true"></i> Volver a invitaciones
            </button>

            ${stepperHtml(m._state)}

            ${locationText(m) ? `
                <span class="sps-detail-place">
                    <i data-wo-icon="map-pin" class="wo-icon-18" aria-hidden="true"></i> ${escapeHtml(locationText(m))}
                </span>
            ` : ''}
            <h1 class="sps-detail-title">${escapeHtml(studioName(m))}</h1>

            ${photos.length ? `
                <div class="sps-gallery">
                    ${photos.map(u => `<span class="sps-gallery-item" style="background-image:url('${cssEscape(u)}')" role="img" aria-label="Foto del estudio"></span>`).join('')}
                </div>
            ` : ''}

            ${desc ? `<p class="sps-detail-desc">${escapeHtml(desc)}</p>` : ''}

            <div class="sps-links">
                ${s.instagram ? `<a href="https://instagram.com/${encodeURIComponent(String(s.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener"><i data-wo-icon="instagram" class="wo-icon-18" aria-hidden="true"></i> @${escapeHtml(String(s.instagram).replace(/^@/, ''))}</a>` : ''}
                ${s.website ? `<a href="${escapeAttr(s.website)}" target="_blank" rel="noopener"><i data-wo-icon="globe" class="wo-icon-18" aria-hidden="true"></i> ${escapeHtml(String(s.website).replace(/^https?:\/\//, ''))}</a>` : ''}
                <span id="inv-roster" hidden></span>
            </div>

            <div class="sps-detail-chips">
                <span class="sps-kind-badge">${escapeHtml(ROLE_BADGES[m.role] || m.role)}</span>
            </div>

            ${cells.length ? `
                <span class="sps-label">Detalles de la invitación</span>
                <div class="sps-meta-grid">
                    ${cells.map(([k, v]) => `
                        <div class="sps-meta-row">
                            <span class="sps-meta-key">${escapeHtml(k)}</span>
                            <span class="sps-meta-val">${escapeHtml(v)}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            ${m.notes ? `
                <span class="sps-label">Mensaje del estudio</span>
                <p class="inv-quote" style="color:var(--text-body);">“${escapeHtml(m.notes)}”</p>
                <p class="inv-terms" style="color:var(--text-muted);">— ${escapeHtml(studioName(m))}</p>
            ` : ''}
        `;
    }

    function buildDetailAside(m) {
        const s = studioOf(m);
        const contact = s.instagram
            ? `<a href="https://instagram.com/${encodeURIComponent(String(s.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener">@${escapeHtml(String(s.instagram).replace(/^@/, ''))}</a>`
            : '';

        const actions = m._state === 'pending'
            ? `
                <button class="wo-btn wo-btn--direct wo-btn--block wo-btn--hard" data-action="accept" data-id="${escapeAttr(m.id)}">
                    Aceptar invitación <i data-wo-icon="check" class="wo-icon-18" aria-hidden="true"></i>
                </button>
                ${contact ? `<a class="wo-btn wo-btn--ghost wo-btn--block" href="https://instagram.com/${encodeURIComponent(String(s.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener">Contactar al estudio</a>` : ''}
                <button class="wo-btn wo-btn--secondary wo-btn--block" data-action="reject" data-id="${escapeAttr(m.id)}">Rechazar invitación</button>
            `
            : m._state === 'active'
                ? `
                    ${s.slug ? `<a class="wo-btn wo-btn--ghost wo-btn--block" href="/studio/profile/?studio=${encodeURIComponent(s.slug)}" target="_blank" rel="noopener">Ver estudio</a>` : ''}
                    <button class="wo-btn wo-btn--secondary wo-btn--block" data-action="leave" data-id="${escapeAttr(m.id)}">Salir del roster</button>
                `
                : `${s.slug ? `<a class="wo-btn wo-btn--ghost wo-btn--block" href="/studio/profile/?studio=${encodeURIComponent(s.slug)}" target="_blank" rel="noopener">Ver estudio</a>` : ''}`;

        return `
            <h2 class="inv-aside-title">Resumen de la invitación</h2>
            <p class="inv-aside-sub">${m._state === 'pending'
                ? 'El estudio te seleccionó. Revisá las condiciones y respondé.'
                : m._state === 'active'
                    ? 'Ya formás parte del roster de este estudio.'
                    : 'Rechazaste esta invitación. El estudio puede volver a invitarte.'}</p>

            <div class="inv-aside-rows">
                <div class="inv-aside-row">
                    <span class="sps-meta-key">Estado</span>
                    <span class="sps-meta-val">${escapeHtml(STATE_LABELS[m._state])}</span>
                </div>
                ${locationText(m) ? `
                    <div class="inv-aside-row">
                        <span class="sps-meta-key">Sede</span>
                        <span class="sps-meta-val">${escapeHtml(locationText(m))}</span>
                    </div>
                ` : ''}
                ${contact ? `
                    <div class="inv-aside-row">
                        <span class="sps-meta-key">Contacto</span>
                        <span class="sps-meta-val">${contact}</span>
                    </div>
                ` : ''}
            </div>

            ${m._state === 'pending' ? `
                <span class="sps-label">Si aceptás</span>
                <ul class="inv-checklist">
                    <li>Aparecés en el perfil público del estudio y en el mapa</li>
                    <li>El estudio te suma a su roster con el rol propuesto</li>
                    <li>Tu perfil personal sigue siendo tuyo — el estudio no puede editarlo</li>
                </ul>
            ` : ''}

            <div class="inv-aside-actions">${actions}</div>
        `;
    }

    function openDetail(m, options = {}) {
        const view = document.getElementById('inv-detail-view');
        if (!view || !m) return;

        currentItem = m;
        view.innerHTML = `
            <div class="inv-detail-main">${buildDetailMain(m)}</div>
            <aside class="inv-detail-aside" aria-label="Resumen de la invitación">${buildDetailAside(m)}</aside>
        `;

        document.getElementById('inv-back')?.addEventListener('click', backToList);
        view.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const { action, id } = btn.dataset;
                if (action === 'leave') leave(id);
                else decide(action, id);
            });
        });

        syncUrl(m, options.push !== false);
        showView('detail');
        loadRosterCount(m);
    }

    // "N artistas residentes" — conteo real del roster activo del estudio.
    async function loadRosterCount(m) {
        const studioId = studioOf(m).id;
        if (!studioId) return;
        const { data, error } = await WeotziData.StudioMemberships.listActiveRosterWithArtists(studioId);
        if (error || !data || data.length === 0) return;
        const el = document.getElementById('inv-roster');
        if (!el || currentItem?.id !== m.id) return;
        el.innerHTML = `<i data-wo-icon="users" class="wo-icon-18" aria-hidden="true"></i> ${data.length} artista${data.length === 1 ? '' : 's'} residente${data.length === 1 ? '' : 's'}`;
        el.hidden = false;
    }

    // ============================================
    // ACCIONES
    // ============================================

    async function decide(action, membershipId) {
        if (action !== 'accept' && action !== 'reject') return;
        const { error } = await WeotziData.StudioMemberships.respondToInvitation(membershipId, userId, action);
        if (error) {
            alert('Error: ' + error.message);
            return;
        }
        currentItem = null;
        syncUrl(null, false);
        showView('feed');
        await load();
    }

    async function leave(membershipId) {
        if (!confirm('¿Salir del roster de este estudio? Tu perfil personal queda intacto.')) return;
        const { error } = await WeotziData.StudioMemberships.endMembership(membershipId);
        if (error) {
            alert('Error: ' + error.message);
            return;
        }
        currentItem = null;
        syncUrl(null, false);
        showView('feed');
        await load();
    }

    // -------- helpers --------
    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(v) { return escapeHtml(v); }
    function cssEscape(v) { return String(v).replace(/'/g, "\\'").replace(/"/g, '\\"'); }
    function shortDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].slice(0, 3)}`;
    }
    function longDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return `${d.getDate()} de ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`;
    }
})();
