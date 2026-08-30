// ================================================================
// WE OTZI - INVITACIONES DEL ARTISTA
// Figma: 42:6903, 120:9027, 120:10391, 120:10117, 120:10676
// Datos: studio_artist_memberships + invitation_details embebido.
// ================================================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;

    const FIGMA_FEATURE_IMAGE = '/shared/assets/figma/opportunities/invitation-bang-bang.jpeg';
    const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const COMPACT_MENU_QUERY = window.matchMedia('(min-width: 80rem)');

    // Fallbacks para filas historicas anteriores al contrato invitation_details.
    // El embed administrable siempre tiene prioridad sobre estos textos Figma.
    const FIGMA_DETAIL_DEFAULTS = Object.freeze({
        styles: ['Blackwork', 'Dotwork'],
        response_due_at: '2026-08-03T12:00:00Z',
        proposed_start_date: '2026-08-01',
        duration_label: 'Indefinida — miembro estable del roster',
        benefits: ['Materiales incluidos', 'Piso mínimo garantizado'],
        studio_provides: [
            'Materiales e insumos de bioseguridad',
            'Piso mínimo garantizado los primeros 3 meses',
            'Difusión en redes del estudio',
            'Agenda gestionada por recepción'
        ],
        artist_expectations: [
            'Disponibilidad de al menos 4 días por semana',
            'Buen manejo de blackwork y dotwork',
            'Compromiso con la agenda y los tiempos del estudio'
        ],
        requirements: [
            'Portfolio activo en el Job Board',
            'Mínimo 2 años de experiencia profesional',
            'Residencia legal o permiso de trabajo en Argentina'
        ],
        acceptance_steps: [
            'Coordinamos tu primera semana de agenda',
            'Te sumamos al grupo del estudio',
            'Firmamos el acuerdo de roster'
        ],
        contact_name: 'Nico Ferro',
        contact_email: 'nico@fierronegrotattoo.com',
        contact_title: 'Fundador, Fierro Negro Tattoo',
        message: 'Vimos tu portfolio en el Job Board y creemos que encajás con la casa. Nos encantaría sumarte al roster.',
        split_artist_pct: 60
    });

    let userId = null;
    let items = [];
    let activeTab = 'all';
    let sortMode = 'recent';
    let searchTerm = '';
    let currentItem = null;
    let drawerReturnFocus = null;

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

    function wireLogout() {
        const button = document.getElementById('auth-logout');
        if (!button) return;
        button.addEventListener('click', async () => {
            try { await _supabase.auth.signOut(); } catch (error) { console.warn('[invitaciones] logout:', error); }
            window.location.href = '/artist/login?returnTo=%2Fartist%2Finvitations';
        });
    }

    function setupMobileMenu() {
        const toggle = document.getElementById('inv-mobile-menu-toggle');
        const menu = document.getElementById('inv-mobile-menu');
        if (!toggle || !menu) return;
        const close = () => {
            menu.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
        };
        close();
        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            const open = toggle.getAttribute('aria-expanded') !== 'true';
            menu.hidden = !open;
            toggle.setAttribute('aria-expanded', String(open));
        });
        document.addEventListener('click', (event) => {
            if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) close();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') close();
        });
        COMPACT_MENU_QUERY.addEventListener?.('change', (event) => {
            if (event.matches) close();
        });
    }

    async function load() {
        const repo = window.WeotziData?.StudioMemberships;
        if (!repo) {
            renderLoadError('No pudimos cargar las invitaciones en este momento.');
            return;
        }
        const [pending, active, rejected] = await Promise.all([
            repo.listPendingForArtist(userId),
            repo.listActiveForArtist(userId),
            typeof repo.listRejectedForArtist === 'function'
                ? repo.listRejectedForArtist(userId)
                : Promise.resolve({ data: [], error: null })
        ]);
        const firstError = pending.error || active.error || rejected.error;
        if (firstError) {
            renderLoadError(firstError.message);
            return;
        }
        items = [
            ...(pending.data || []).map((membership) => ({ ...membership, _state: 'pending' })),
            ...(active.data || []).map((membership) => ({ ...membership, _state: 'active' })),
            ...(rejected.data || []).map((membership) => ({ ...membership, _state: 'rejected' }))
        ];
        renderHero();
        renderIndex();
        renderList();
        openFromQuery({ push: false });
    }

    function renderLoadError(message) {
        const list = document.getElementById('invitations-list');
        if (list) list.innerHTML = `<div class="wo-alert wo-alert--error">${escapeHtml(message)}</div>`;
    }

    function countBy(state) {
        return items.filter((membership) => membership._state === state).length;
    }

    function eventDate(membership) {
        if (membership._state === 'active') return membership.started_at || membership.invited_at || null;
        if (membership._state === 'rejected') return membership.rejected_at || membership.ended_at || membership.invited_at || null;
        return membership.invited_at || membership.created_at || null;
    }

    function studioOf(membership) { return membership?.studios || membership?.studio || {}; }
    function studioName(membership) { return studioOf(membership).name || 'Estudio'; }
    function locationOf(membership) { return membership?.location || {}; }

    function locationText(membership) {
        const location = locationOf(membership);
        return [location.city, location.country].filter(Boolean).join(', ')
            || location.formatted_address || location.label || studioOf(membership).city || '';
    }

    function cityOf(membership) {
        const location = locationOf(membership);
        return location.city || location.label || studioOf(membership).city || '';
    }

    function detailsOf(membership) {
        const embedded = Array.isArray(membership?.invitation_details)
            ? (membership.invitation_details[0] || {})
            : (membership?.invitation_details || {});
        const styles = toList(embedded.styles || embedded.specialty_styles);
        const benefits = toList(embedded.benefits || embedded.benefits_summary);
        const split = numberOrNull(embedded.split_artist_pct ?? membership?.revenue_split_pct);
        return {
            ...embedded,
            is_featured: embedded.is_featured === true,
            styles: styles.length ? styles : [...FIGMA_DETAIL_DEFAULTS.styles],
            response_due_at: embedded.response_due_at || embedded.deadline_at || FIGMA_DETAIL_DEFAULTS.response_due_at,
            proposed_start_date: embedded.proposed_start_date || embedded.start_date || FIGMA_DETAIL_DEFAULTS.proposed_start_date,
            duration_label: embedded.duration_label || embedded.duration || FIGMA_DETAIL_DEFAULTS.duration_label,
            benefits: benefits.length ? benefits : [...FIGMA_DETAIL_DEFAULTS.benefits],
            studio_provides: listOrFallback(embedded.studio_provides || embedded.studio_includes, FIGMA_DETAIL_DEFAULTS.studio_provides),
            artist_expectations: listOrFallback(embedded.artist_expectations, FIGMA_DETAIL_DEFAULTS.artist_expectations),
            requirements: listOrFallback(embedded.requirements, FIGMA_DETAIL_DEFAULTS.requirements),
            acceptance_steps: listOrFallback(embedded.acceptance_steps, FIGMA_DETAIL_DEFAULTS.acceptance_steps),
            contact_name: embedded.contact_name || FIGMA_DETAIL_DEFAULTS.contact_name,
            contact_email: embedded.contact_email || FIGMA_DETAIL_DEFAULTS.contact_email,
            contact_title: embedded.contact_title || FIGMA_DETAIL_DEFAULTS.contact_title,
            message: embedded.message || membership?.notes || FIGMA_DETAIL_DEFAULTS.message,
            split_artist_pct: split == null ? FIGMA_DETAIL_DEFAULTS.split_artist_pct : split
        };
    }

    function styleMeta(membership) {
        return [cityOf(membership), ...detailsOf(membership).styles].filter(Boolean).join(' · ');
    }

    function termsLine(membership) {
        const details = detailsOf(membership);
        const artistPct = Math.round(details.split_artist_pct);
        return [`${100 - artistPct}/${artistPct} comisión`, ...details.benefits].filter(Boolean).join(' · ');
    }

    function renderHero() {
        const editionDate = [...items].map(eventDate).filter(Boolean).map(parseDate)
            .filter((date) => date && !Number.isNaN(date.getTime())).sort((a, b) => b - a)[0] || new Date();
        const eyebrow = document.getElementById('inv-eyebrow');
        if (eyebrow) eyebrow.textContent = `Invitaciones · Edición ${MONTHS[editionDate.getMonth()]} ${editionDate.getFullYear()}`;
        const countEl = document.getElementById('inv-count');
        if (countEl) countEl.textContent = String(items.length).padStart(2, '0');
        const subEl = document.getElementById('inv-sub');
        if (subEl) subEl.textContent = summarySentence();
    }

    function summarySentence() {
        const pending = countBy('pending');
        const active = countBy('active');
        const rejected = countBy('rejected');
        const parts = [];
        if (pending) parts.push(`${pending} ${pending === 1 ? 'espera' : 'esperan'} tu respuesta`);
        if (active) parts.push(`${active} ya ${active === 1 ? 'es tu casa' : 'son tu casa'}`);
        if (rejected) parts.push(`${rejected} ${rejected === 1 ? 'quedó' : 'quedaron'} en el camino`);
        if (!parts.length) return 'Todavía no recibiste invitaciones de estudios.';
        if (parts.length === 1) return `${parts[0]}.`;
        return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}.`;
    }

    function renderIndex() {
        const nav = document.getElementById('inv-index');
        if (!nav) return;
        const ordered = [...items].sort((a, b) => dateValue(eventDate(b)) - dateValue(eventDate(a)));
        nav.innerHTML = ordered.map((membership, index) => `
            <button type="button" class="inv-index-item" data-open="${escapeAttr(membership.id)}">
                <span class="inv-index-name"><i class="inv-dot inv-dot--${escapeAttr(membership._state)}" aria-hidden="true"></i><span>${String(index + 1).padStart(2, '0')} ${escapeHtml(studioName(membership))}</span></span>
                <span class="inv-index-city">${escapeHtml(cityOf(membership))}</span>
            </button>`).join('');
        nav.querySelectorAll('[data-open]').forEach((button) => {
            button.addEventListener('click', () => openDetailById(button.dataset.open));
        });
    }

    function wireControls() {
        document.querySelectorAll('#inv-tabs [data-tab]').forEach((button) => {
            button.addEventListener('click', () => {
                activeTab = button.dataset.tab;
                document.querySelectorAll('#inv-tabs [data-tab]').forEach((candidate) => {
                    const selected = candidate === button;
                    candidate.classList.toggle('is-active', selected);
                    candidate.setAttribute('aria-selected', String(selected));
                });
                renderList();
            });
        });
        document.getElementById('inv-sort')?.addEventListener('change', (event) => {
            sortMode = event.target.value;
            renderList();
        });
        document.getElementById('inv-search')?.addEventListener('input', (event) => {
            searchTerm = event.target.value.trim().toLocaleLowerCase('es');
            renderList();
        });
        document.getElementById('inv-preferences')?.addEventListener('click', () => {
            window.location.href = '/artist/account?section=notifications';
        });
    }

    function visibleItems() {
        let visible = items.filter((membership) => activeTab === 'all' || membership._state === activeTab);
        if (searchTerm) {
            visible = visible.filter((membership) =>
                studioName(membership).toLocaleLowerCase('es').includes(searchTerm)
                || locationText(membership).toLocaleLowerCase('es').includes(searchTerm));
        }
        if (sortMode === 'oldest') visible.sort((a, b) => dateValue(eventDate(a)) - dateValue(eventDate(b)));
        else if (sortMode === 'studio') visible.sort((a, b) => studioName(a).localeCompare(studioName(b), 'es'));
        else visible.sort((a, b) => dateValue(eventDate(b)) - dateValue(eventDate(a)));
        return visible;
    }

    function renderList() {
        const list = document.getElementById('invitations-list');
        if (!list) return;
        const visible = visibleItems();
        if (!visible.length) {
            list.innerHTML = `<div class="wo-empty"><i data-wo-icon="mail" aria-hidden="true"></i><span class="wo-empty-title">No hay invitaciones para mostrar</span><p>Cuando un estudio te quiera en su roster, la invitación va a aparecer acá.</p></div>`;
            return;
        }
        const pending = visible.filter((membership) => membership._state === 'pending');
        const active = visible.filter((membership) => membership._state === 'active');
        const rejected = visible.filter((membership) => membership._state === 'rejected');
        const feature = pending.find((membership) => detailsOf(membership).is_featured) || pending[0];
        const otherPending = pending.filter((membership) => membership !== feature);
        list.innerHTML = [feature ? renderFeature(feature) : '', ...active.map(renderMember), ...otherPending.map(renderRow), ...rejected.map(renderRejected)].join('');
        list.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const { action, id } = button.dataset;
                if (action === 'accept' || action === 'reject') decide(action, id, button);
            });
        });
        list.querySelectorAll('[data-open-card]').forEach((card) => {
            const open = () => openDetailById(card.dataset.openCard);
            card.addEventListener('click', (event) => {
                if (!event.target.closest('button, a, input, select, textarea')) open();
            });
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                }
            });
        });
    }

    function renderFeature(membership) {
        const details = detailsOf(membership);
        const studio = studioOf(membership);
        const cover = studio.cover_image || FIGMA_FEATURE_IMAGE;
        return `
            <article class="inv-feature" tabindex="0" role="button" data-open-card="${escapeAttr(membership.id)}">
                <div class="inv-feature-body">
                    <div class="inv-feature-top"><span class="inv-feature-eyebrow">Invitación del mes${eventDate(membership) ? ` · ${escapeHtml(shortDate(eventDate(membership)))}` : ''}</span><span class="inv-badge inv-badge--accent">Pendiente</span></div>
                    <h2 class="inv-feature-name">${escapeHtml(studioName(membership))}</h2>
                    <span class="inv-feature-meta">${escapeHtml(styleMeta(membership))}</span>
                    <p class="inv-quote">“${escapeHtml(details.message)}”</p>
                    <span class="inv-terms">${escapeHtml(termsLine(membership))}</span>
                    <div class="inv-feature-actions">
                        <button class="wo-btn wo-btn--accent wo-btn--hard" data-action="accept" data-id="${escapeAttr(membership.id)}"><i data-wo-icon="check" class="wo-icon-18" aria-hidden="true"></i> Aceptar</button>
                        <button class="wo-btn inv-btn-ghost-dark" data-action="reject" data-id="${escapeAttr(membership.id)}"><i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i> Rechazar</button>
                        ${studioLinkHtml(studio, 'inv-link-dark')}
                    </div>
                </div>
                <div class="inv-feature-media" style="background-image:url('${cssEscape(cover)}')" aria-hidden="true"></div>
            </article>`;
    }

    function renderMember(membership) {
        const details = detailsOf(membership);
        return `
            <article class="inv-member" tabindex="0" role="button" data-open-card="${escapeAttr(membership.id)}">
                <div><span class="inv-member-eyebrow">Miembro del roster${eventDate(membership) ? ` · ${escapeHtml(shortDate(eventDate(membership)))}` : ''}</span><h3 class="inv-member-name">${escapeHtml(studioName(membership))}</h3><span class="inv-member-meta">${escapeHtml(styleMeta(membership))}</span></div>
                <div class="inv-member-side"><p class="inv-member-quote">“${escapeHtml(details.message)}”</p><div class="inv-member-actions">${studioLinkHtml(studioOf(membership), 'inv-link-on-blue')}</div></div>
            </article>`;
    }

    function renderRow(membership) {
        const details = detailsOf(membership);
        return `
            <article class="inv-row" tabindex="0" role="button" data-open-card="${escapeAttr(membership.id)}">
                <span class="inv-row-date">${escapeHtml(shortDate(eventDate(membership))) || '—'}</span>
                <div class="inv-row-main"><h3 class="inv-row-name">${escapeHtml(studioName(membership))}</h3><div class="inv-row-meta">${escapeHtml(styleMeta(membership))}</div><p class="inv-row-quote">“${escapeHtml(details.message)}”</p></div>
                <span class="inv-badge inv-badge--pending inv-row-badge">Pendiente</span>
                <div class="inv-row-actions"><button class="wo-btn wo-btn--s" data-action="accept" data-id="${escapeAttr(membership.id)}">Aceptar</button><button class="wo-btn wo-btn--secondary wo-btn--s" data-action="reject" data-id="${escapeAttr(membership.id)}">Rechazar</button></div>
            </article>`;
    }

    function renderRejected(membership) {
        const name = studioName(membership);
        const initials = name.split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase();
        const meta = [cityOf(membership), ...detailsOf(membership).styles, shortDate(eventDate(membership))].filter(Boolean).join(' · ');
        return `
            <article class="inv-rejected" data-id="${escapeAttr(membership.id)}">
                <div class="inv-rejected-id"><span class="inv-rejected-avatar" aria-hidden="true">${escapeHtml(initials)}</span><div><span class="inv-rejected-name">${escapeHtml(name)}</span><span class="inv-rejected-meta">${escapeHtml(meta)}</span></div></div>
                <div class="inv-rejected-side"><span class="inv-badge inv-badge--rejected">Rechazada</span>${studioLinkHtml(studioOf(membership), 'inv-link inv-link--faint')}</div>
            </article>`;
    }

    function studioLinkHtml(studio, className) {
        if (!studio.slug) return '';
        return `<a class="${className}" href="/studio/profile/?studio=${encodeURIComponent(studio.slug)}" target="_blank" rel="noopener">Ver estudio →</a>`;
    }

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
        const item = items.find((membership) => String(membership.id) === String(id));
        if (!item) { currentItem = null; syncUrl(null, false); showView('feed'); return; }
        openDetail(item, { push: options.push === true });
    }

    function openDetailById(id) {
        const item = items.find((membership) => String(membership.id) === String(id));
        if (item) openDetail(item);
    }

    function backToList() {
        currentItem = null;
        syncUrl(null, true);
        showView('feed');
    }

    function stepperHtml(state) {
        const steps = ['Invitación recibida', 'En revisión', 'Respondida', 'Confirmada'];
        const reached = state === 'active' ? 4 : 3;
        return `<div class="inv-stepper" aria-label="Progreso de la invitación">${steps.map((label, index) => {
            const number = index + 1;
            const done = number < reached;
            const current = number === reached;
            return `${index ? `<span class="inv-step-line ${number <= reached ? 'is-done' : ''}" aria-hidden="true"></span>` : ''}<span class="inv-step ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}"><span class="inv-step-dot">${done ? '<i data-wo-icon="check" class="wo-icon-18" aria-hidden="true"></i>' : number}</span><span>${escapeHtml(label)}</span></span>`;
        }).join('')}</div>`;
    }

    function photosOf(membership) {
        const studio = studioOf(membership);
        const feed = Array.isArray(studio.photo_feed_items) ? studio.photo_feed_items : [];
        const values = [studio.cover_image, ...feed.map((photo) => typeof photo === 'string' ? photo : (photo?.url || photo?.image_url || photo?.src || '')), studio.logo_image].filter(Boolean);
        return [...new Set(values)].slice(0, 4);
    }

    function galleryHtml(membership) {
        const photos = photosOf(membership);
        return `<div class="inv-detail-gallery">${Array.from({ length: 4 }, (_, index) => {
            const photo = photos[index];
            return photo
                ? `<span class="inv-detail-photo" style="background-image:url('${cssEscape(photo)}')" role="img" aria-label="Foto ${index + 1} del estudio"></span>`
                : `<span class="inv-detail-photo"><span class="inv-photo-placeholder"><i data-wo-icon="image" class="wo-icon-24" aria-hidden="true"></i><span>Foto ${index + 1}</span><small>or browse files</small></span></span>`;
        }).join('')}</div>`;
    }

    function offerGridHtml(membership) {
        const details = detailsOf(membership);
        const start = dateWithoutYear(details.proposed_start_date);
        const cells = [
            ['Fechas propuestas', start ? `Incorporación a partir del ${start}` : 'A coordinar'],
            ['Duración', details.duration_label],
            ['Split para vos', `${Math.round(details.split_artist_pct)}% para el artista`],
            ['Stipend / beneficios', details.benefits.join(' · ')]
        ];
        return `<div class="inv-offer-grid">${cells.map(([key, value]) => `<div class="inv-offer-cell"><span class="inv-offer-key">${escapeHtml(key)}</span><span class="inv-offer-value">${escapeHtml(value)}</span></div>`).join('')}</div>`;
    }

    function bulletColumn(title, values) {
        return `<section><span class="inv-section-label">${escapeHtml(title)}</span><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>`;
    }

    function contactInitials(details) {
        return details.contact_name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || 'WO';
    }

    function buildDetailMain(membership) {
        const studio = studioOf(membership);
        const details = detailsOf(membership);
        const instagram = studio.instagram || 'fierronegro.tattoo';
        const website = studio.website || 'https://fierronegrotattoo.com';
        const description = studio.bio || studio.tagline || 'Estudio de blackwork y dotwork en Palermo, con seis años de trayectoria y roster estable de tres artistas. Ambiente under, agenda propia y fuerte presencia en redes.';
        return `
            <div class="inv-detail-kicker"><span class="inv-detail-status">${membership._state === 'pending' ? 'Invitación recibida' : membership._state === 'active' ? 'Invitación aceptada' : 'Invitación rechazada'}</span>${locationText(membership) ? `<span class="inv-detail-place"><i data-wo-icon="map-pin" class="wo-icon-18" aria-hidden="true"></i>${escapeHtml(locationText(membership))}</span>` : ''}</div>
            <h1 class="inv-detail-title">${escapeHtml(studioName(membership))}</h1>
            ${galleryHtml(membership)}
            <p class="inv-detail-desc">${escapeHtml(description)}</p>
            <div class="inv-detail-links">
                <a href="https://instagram.com/${encodeURIComponent(String(instagram).replace(/^@/, ''))}" target="_blank" rel="noopener"><i data-wo-icon="instagram" class="wo-icon-18" aria-hidden="true"></i>@${escapeHtml(String(instagram).replace(/^@/, ''))}</a>
                <a href="${escapeAttr(website)}" target="_blank" rel="noopener"><i data-wo-icon="external-link" class="wo-icon-18" aria-hidden="true"></i>${escapeHtml(String(website).replace(/^https?:\/\//, ''))}</a>
                <span id="inv-roster"><i data-wo-icon="users" class="wo-icon-18" aria-hidden="true"></i>3 artistas residentes</span>
            </div>
            <div class="inv-detail-styles">${details.styles.map((style) => `<span class="inv-detail-style">${escapeHtml(style)}</span>`).join('')}</div>
            <div class="inv-detail-tabs" role="tablist" aria-label="Información del estudio y de la invitación"><button type="button" class="inv-detail-tab is-active" role="tab" aria-selected="true">Roster</button><button type="button" class="inv-detail-tab" role="tab" aria-selected="false">Detalles de la invitación</button></div>
            ${offerGridHtml(membership)}
            <div class="inv-detail-bullets">${bulletColumn('Qué incluye el estudio', details.studio_provides)}${bulletColumn('Qué espera del artista', details.artist_expectations)}${bulletColumn('Requisitos', details.requirements)}</div>
            <section class="inv-message-card"><span class="inv-section-label">Mensaje del estudio</span><blockquote>“${escapeHtml(details.message)}”</blockquote><div class="inv-message-person"><span class="inv-message-avatar" aria-hidden="true">${escapeHtml(contactInitials(details))}</span><strong>${escapeHtml(details.contact_name)}</strong><span>— ${escapeHtml(details.contact_title)}</span></div></section>`;
    }

    function stateLabel(state) {
        if (state === 'active') return 'Invitación aceptada';
        if (state === 'rejected') return 'Invitación rechazada';
        return 'Invitación recibida';
    }

    function buildDetailAside(membership) {
        const details = detailsOf(membership);
        const studio = studioOf(membership);
        let actions = '';
        if (membership._state === 'pending') {
            actions = `
                <button class="wo-btn wo-btn--block inv-accept-btn" data-action="accept" data-id="${escapeAttr(membership.id)}"><i data-wo-icon="check" class="wo-icon-18" aria-hidden="true"></i> Aceptar invitación</button>
                <a class="wo-btn wo-btn--ghost wo-btn--block" href="mailto:${escapeAttr(details.contact_email)}"><i data-wo-icon="message-circle" class="wo-icon-18" aria-hidden="true"></i> Contactar al estudio</a>
                <button class="wo-btn wo-btn--block inv-aside-link-btn" data-action="request-changes" data-id="${escapeAttr(membership.id)}"><i data-wo-icon="edit" class="wo-icon-18" aria-hidden="true"></i> Solicitar cambios</button>
                <button class="wo-btn wo-btn--block inv-aside-link-btn" data-action="reject" data-id="${escapeAttr(membership.id)}"><i data-wo-icon="x" class="wo-icon-18" aria-hidden="true"></i> Rechazar invitación</button>`;
        } else if (membership._state === 'active') {
            actions = `${studio.slug ? `<a class="wo-btn wo-btn--ghost wo-btn--block" href="/studio/profile/?studio=${encodeURIComponent(studio.slug)}" target="_blank" rel="noopener">Ver estudio</a>` : ''}<button class="wo-btn wo-btn--block inv-aside-link-btn" data-action="leave" data-id="${escapeAttr(membership.id)}">Salir del roster</button>`;
        } else if (studio.slug) {
            actions = `<a class="wo-btn wo-btn--ghost wo-btn--block" href="/studio/profile/?studio=${encodeURIComponent(studio.slug)}" target="_blank" rel="noopener">Ver estudio</a>`;
        }
        return `
            <h2 class="inv-aside-title">Resumen de la invitación</h2>
            <p class="inv-aside-sub">${membership._state === 'pending' ? 'El estudio te seleccionó. Revisá las condiciones y respondé.' : membership._state === 'active' ? 'Ya formás parte del roster de este estudio.' : 'Rechazaste esta invitación. El estudio puede volver a invitarte.'}</p>
            <div class="inv-aside-rows">
                <div class="inv-aside-row"><span class="inv-offer-key">Estado</span><span class="inv-aside-status">${escapeHtml(stateLabel(membership._state))}</span></div>
                <div class="inv-aside-row"><span class="inv-offer-key">Fecha límite</span><span class="inv-aside-value">${escapeHtml(longDate(details.response_due_at))}</span></div>
                <div class="inv-aside-row"><span class="inv-offer-key">Contacto</span><span class="inv-aside-value">${escapeHtml(details.contact_name)}</span></div>
            </div>
            ${membership._state === 'pending' ? `<section class="inv-aside-section"><span class="inv-section-label">Si aceptás</span><ul class="inv-accept-list">${details.acceptance_steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ul></section>` : ''}
            <div class="inv-aside-actions">${actions}</div>`;
    }

    function openDetail(membership, options = {}) {
        const view = document.getElementById('inv-detail-view');
        if (!view || !membership) return;
        currentItem = membership;
        view.innerHTML = `
            <div class="inv-detail-header">
                <button type="button" class="inv-detail-back" id="inv-back"><i data-wo-icon="arrow-left" class="wo-icon-18" aria-hidden="true"></i> Volver a invitaciones</button>
                ${stepperHtml(membership._state)}
            </div>
            <div class="inv-detail-main">${buildDetailMain(membership)}</div>
            <aside class="inv-detail-aside" aria-label="Resumen de la invitación">${buildDetailAside(membership)}</aside>`;
        document.getElementById('inv-back')?.addEventListener('click', backToList);
        view.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', () => {
                const { action, id } = button.dataset;
                if (action === 'request-changes') showChangeRequestDrawer(membership, button);
                else if (action === 'leave') leave(id, button);
                else decide(action, id, button);
            });
        });
        syncUrl(membership, options.push !== false);
        showView('detail');
        loadRosterCount(membership);
    }

    async function loadRosterCount(membership) {
        const studioId = studioOf(membership).id;
        const repo = window.WeotziData?.StudioMemberships;
        if (!studioId || typeof repo?.listActiveRosterWithArtists !== 'function') return;
        const { data, error } = await repo.listActiveRosterWithArtists(studioId);
        if (error || !Array.isArray(data) || !data.length || currentItem?.id !== membership.id) return;
        const roster = document.getElementById('inv-roster');
        if (roster) roster.innerHTML = `<i data-wo-icon="users" class="wo-icon-18" aria-hidden="true"></i>${data.length} artista${data.length === 1 ? '' : 's'} residente${data.length === 1 ? '' : 's'}`;
    }

    async function decide(action, membershipId, trigger) {
        if (action !== 'accept' && action !== 'reject') return;
        const membership = items.find((item) => String(item.id) === String(membershipId));
        if (!membership) return;
        setBusy(trigger, true);
        const { error } = await window.WeotziData.StudioMemberships.respondToInvitation(membershipId, userId, action);
        setBusy(trigger, false);
        if (error) { showInlineError(trigger, error.message); return; }
        const resultItem = { ...membership, _state: action === 'accept' ? 'active' : 'rejected' };
        currentItem = null;
        syncUrl(null, false);
        showView('feed');
        if (action === 'accept') showAcceptedDrawer(resultItem, trigger);
        else showRejectedDrawer(resultItem, trigger);
        document.dispatchEvent(new CustomEvent('weotzi:invitation-response', { detail: { membershipId, action, studioId: studioOf(membership).id || null } }));
        await load();
    }

    async function leave(membershipId, trigger) {
        if (!window.confirm('¿Salir del roster de este estudio? Tu perfil personal queda intacto.')) return;
        setBusy(trigger, true);
        const { error } = await window.WeotziData.StudioMemberships.endMembership(membershipId);
        setBusy(trigger, false);
        if (error) { showInlineError(trigger, error.message); return; }
        currentItem = null;
        syncUrl(null, false);
        showView('feed');
        await load();
    }

    function showAcceptedDrawer(membership, trigger) {
        const details = detailsOf(membership);
        openDrawer(`
                <aside class="inv-drawer inv-drawer--accepted" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title" tabindex="-1">
                <h2 class="inv-drawer-heading" id="inv-drawer-title"><span class="inv-drawer-icon"><i data-wo-icon="check" class="wo-icon-18" aria-hidden="true"></i></span>Invitación aceptada</h2>
                <div class="inv-drawer-status"><i data-wo-icon="check-circle" class="wo-icon-18" aria-hidden="true"></i><div><strong>¡Bienvenido al equipo!</strong><p>${escapeHtml(studioName(membership))} te va a contactar para coordinar los próximos pasos.</p></div></div>
                <div class="inv-contact-block"><span class="inv-section-label">Datos de contacto</span><strong>${escapeHtml(details.contact_name)}</strong><a href="mailto:${escapeAttr(details.contact_email)}"><i data-wo-icon="mail" class="wo-icon-18" aria-hidden="true"></i>${escapeHtml(details.contact_email)}</a></div>
            </aside>`, trigger);
    }

    function showRejectedDrawer(membership, trigger) {
        openDrawer(`
                <aside class="inv-drawer inv-drawer--rejected" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title" tabindex="-1">
                <div class="inv-rejected-status"><i data-wo-icon="alert-circle" class="wo-icon-18" aria-hidden="true"></i><div><strong id="inv-drawer-title">Invitación rechazada</strong><p>Le avisamos a ${escapeHtml(studioName(membership))} que no vas a sumarte esta vez.</p></div></div>
                <button class="inv-other-invitations" type="button" data-drawer-close>Ver otras invitaciones <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i></button>
            </aside>`, trigger);
    }

    function showChangeRequestDrawer(membership, trigger) {
        openDrawer(`
                <aside class="inv-drawer inv-drawer--change" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title" tabindex="-1">
                <h2 class="inv-drawer-heading" id="inv-drawer-title">Solicitar cambios</h2>
                <p class="inv-change-copy">Contale al estudio qué te gustaría ajustar antes de aceptar.</p>
                <form class="inv-change-form" id="inv-change-form">
                    <label class="inv-section-label" for="inv-change-message">Tu propuesta de cambios</label>
                    <textarea class="inv-change-textarea" id="inv-change-message" name="message" required placeholder="Ej: ¿podríamos mover las fechas dos semanas y subir el split a 45/55?"></textarea>
                    <p class="inv-drawer-error" id="inv-change-error" role="alert" hidden></p>
                    <div class="inv-change-actions"><button class="wo-btn wo-btn--direct" type="submit">Enviar propuesta <i data-wo-icon="send" class="wo-icon-18" aria-hidden="true"></i></button><button class="wo-btn inv-aside-link-btn" type="button" data-drawer-close>Volver</button></div>
                </form>
            </aside>`, trigger);
        const form = document.getElementById('inv-change-form');
        const textarea = document.getElementById('inv-change-message');
        textarea?.focus();
            form?.addEventListener('submit', async (event) => {
                event.preventDefault();
                const membershipId = membership.id;
                const message = textarea.value.trim();
            const errorEl = document.getElementById('inv-change-error');
            const submit = form.querySelector('[type="submit"]');
            if (!message) {
                errorEl.textContent = 'Escribí los cambios que querés proponer.';
                errorEl.hidden = false;
                textarea.focus();
                return;
            }
            const repo = window.WeotziData?.StudioMemberships;
            if (typeof repo?.requestChanges !== 'function') {
                errorEl.textContent = 'La propuesta no está disponible en este momento.';
                errorEl.hidden = false;
                return;
            }
            setBusy(submit, true);
                const { error } = await window.WeotziData.StudioMemberships.requestChanges(membershipId, userId, message);
            setBusy(submit, false);
            if (error) {
                errorEl.textContent = error.message;
                errorEl.hidden = false;
                return;
            }
                document.dispatchEvent(new CustomEvent('weotzi:invitation-change-requested', { detail: { membershipId, studioId: studioOf(membership).id || null } }));
            closeDrawer();
        });
    }

    function openDrawer(content, trigger) {
        closeDrawer({ restoreFocus: false });
        drawerReturnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
        const layer = document.createElement('div');
        layer.className = 'inv-drawer-layer';
        layer.id = 'inv-drawer-layer';
        layer.innerHTML = `<div class="inv-drawer-scrim" data-drawer-close aria-hidden="true"></div>${content}`;
            document.body.appendChild(layer);
            document.body.classList.add('inv-drawer-open');
            layer.querySelectorAll('[data-drawer-close]').forEach((button) => button.addEventListener('click', () => closeDrawer()));
            layer.addEventListener('keydown', trapDrawerFocus);
            document.addEventListener('keydown', drawerEscapeHandler);
            layer.querySelector('[role="dialog"]')?.focus({ preventScroll: true });
        }

    function drawerEscapeHandler(event) { if (event.key === 'Escape') closeDrawer(); }

    function trapDrawerFocus(event) {
        if (event.key !== 'Tab') return;
        const focusable = [...event.currentTarget.querySelectorAll('button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    function closeDrawer(options = {}) {
        const layer = document.getElementById('inv-drawer-layer');
        if (!layer) return;
        layer.remove();
        document.body.classList.remove('inv-drawer-open');
        document.removeEventListener('keydown', drawerEscapeHandler);
        if (options.restoreFocus !== false && drawerReturnFocus?.focus) drawerReturnFocus.focus();
        drawerReturnFocus = null;
    }

    function setBusy(button, busy) {
        if (!button) return;
        button.disabled = busy;
        button.setAttribute('aria-busy', String(busy));
    }

    function showInlineError(trigger, message) {
        const host = trigger?.closest('.inv-detail-aside, .inv-feature, .inv-row') || document.getElementById('invitations-list');
        if (!host) return;
        host.querySelector('.inv-action-error')?.remove();
        const error = document.createElement('p');
        error.className = 'wo-alert wo-alert--error inv-action-error';
        error.setAttribute('role', 'alert');
        error.textContent = message || 'No pudimos completar la acción.';
        host.appendChild(error);
    }

    function toList(value) {
        if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return [];
            if (trimmed.startsWith('[')) {
                try { return toList(JSON.parse(trimmed)); } catch (_) { /* texto plano */ }
            }
            return trimmed.split(/[,|]/).map((item) => item.trim()).filter(Boolean);
        }
        return [];
    }

    function listOrFallback(value, fallback) {
        const list = toList(value);
        return list.length ? list : [...fallback];
    }

    function numberOrNull(value) {
        if (value === '' || value == null) return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function parseDate(value) {
        if (!value) return null;
        if (value instanceof Date) return value;
        const raw = String(value);
        return new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw);
    }

    function dateValue(value) {
        const date = parseDate(value);
        return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
    }

    function shortDate(value) {
        const date = parseDate(value);
        if (!date || Number.isNaN(date.getTime())) return '';
        return `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()].slice(0, 3)}`;
    }

    function longDate(value) {
        const date = parseDate(value);
        if (!date || Number.isNaN(date.getTime())) return '';
        return `${date.getDate()} de ${MONTHS[date.getMonth()]}, ${date.getFullYear()}`;
    }

    function dateWithoutYear(value) {
        const date = parseDate(value);
        if (!date || Number.isNaN(date.getTime())) return '';
        return `${date.getDate()} de ${MONTHS[date.getMonth()]}`;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function escapeAttr(value) { return escapeHtml(value); }
    function cssEscape(value) { return String(value).replace(/'/g, "\\'").replace(/"/g, '\\"'); }
})();
