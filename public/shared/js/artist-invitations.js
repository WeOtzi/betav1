// ================================================================
// WE OTZI - INVITACIONES DEL ARTISTA (/artist/invitations)
// Figma final del flujo de artista (oct 2026), archivo w3JA83CcP5ISKjyOu87mx1:
//   801:540  listado · 801:541 detalle y condiciones
//   801:1101 solicitar cambios · 801:1102 aceptada · 801:1103 rechazada
//   2007:5792/5793 mapa (invitations-map.js) · 2007:5794 estudio y
//   2007:5795 escribir al estudio (invitations-studio.js)
//
// Rutas internas (parámetros de URL, también útiles para QA):
//   ?invitacion=<membership_id>[&drawer=cambios|aceptada|rechazada]
//   ?vista=mapa[&estudio=<studio_id>][&grupo=<studio_id>,<studio_id>…]
//   ?estudio=<studio_id>[&contactar=1]
// Datos: WeotziData.StudioMemberships (+ invitation_details embebido) y
// WeotziData.Invitations (invitations-repo.js).
// ================================================================

(function () {
    'use strict';

    const M = window.WoInvitationsModel;
    const D = window.WeotziData || {};
    const PLACEHOLDER = '—';

    const state = {
        userId: null,
        items: [],
        contacts: [],
        loaded: false,
        activeTab: 'all',
        sortMode: 'recent',
        searchTerm: '',
        detailTab: 'roster',
        current: null,
        returnFocus: null,
    };

    /* ----------------------------- utilidades ----------------------------- */
    function basePath() {
        return window.WEOTZI_BASE_PATH ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '') : '';
    }

    function appUrl(path) {
        const value = String(path || '/');
        if (!value.startsWith('/') || value.startsWith('//')) return value;
        const base = basePath();
        return base && !value.startsWith(base + '/') ? base + value : value;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function cssUrl(value) {
        return String(value).replace(/["'()\\\s]/g, (ch) => encodeURIComponent(ch));
    }

    function icon(name, extra) {
        return `<i data-wo-icon="${name}"${extra ? ` class="${extra}"` : ''} aria-hidden="true"></i>`;
    }

    function studioOf(membership) { return (membership && (membership.studios || membership.studio)) || {}; }
    function studioName(membership) { return studioOf(membership).name || 'Estudio'; }
    function locationOf(membership) { return (membership && membership.location) || {}; }

    function cityOf(membership) {
        const location = locationOf(membership);
        return location.city || location.label || studioOf(membership).city || '';
    }

    function locationText(membership) {
        const location = locationOf(membership);
        return [location.city, location.country].filter(Boolean).join(', ')
            || location.formatted_address || studioOf(membership).city || '';
    }

    function detailsOf(membership) {
        const raw = Array.isArray(membership && membership.invitation_details)
            ? (membership.invitation_details[0] || {})
            : ((membership && membership.invitation_details) || {});
        const split = M.numberOrNull(raw.split_artist_pct != null ? raw.split_artist_pct : membership && membership.revenue_split_pct);
        return {
            isFeatured: raw.is_featured === true,
            styles: M.toList(raw.styles || raw.specialty_styles),
            responseDueAt: raw.response_due_at || raw.deadline_at || null,
            startDate: raw.proposed_start_date || raw.start_date || null,
            duration: M.text(raw.duration_label || raw.duration),
            benefits: M.toList(raw.benefits || raw.benefits_summary),
            provides: M.toList(raw.studio_provides || raw.studio_includes),
            expectations: M.toList(raw.artist_expectations),
            requirements: M.toList(raw.requirements),
            steps: M.toList(raw.acceptance_steps),
            contactName: M.text(raw.contact_name),
            contactEmail: M.text(raw.contact_email),
            contactTitle: M.text(raw.contact_title),
            message: M.text(raw.message) || M.text(membership && membership.notes),
            split,
        };
    }

    function eventDate(membership) {
        if (membership._state === 'active') return membership.started_at || membership.invited_at || null;
        if (membership._state === 'rejected') return membership.ended_at || membership.invited_at || null;
        return membership.invited_at || membership.created_at || null;
    }

    function styleMeta(membership) {
        return [cityOf(membership)].concat(detailsOf(membership).styles).filter(Boolean).join(' · ');
    }

    function termsLine(membership) {
        const details = detailsOf(membership);
        const parts = [];
        if (details.split != null) {
            const artist = Math.round(details.split);
            parts.push(`${100 - artist}/${artist} comisión`);
        }
        return parts.concat(details.benefits).join(' · ');
    }

    function countBy(stateName) { return state.items.filter((item) => item._state === stateName).length; }

    function findItem(id) { return state.items.find((item) => String(item.id) === String(id)) || null; }

    function membershipForStudio(studioId) {
        const rows = state.items.filter((item) => String(studioOf(item).id || item.studio_id) === String(studioId));
        return rows.sort((a, b) => M.dateValue(b.invited_at) - M.dateValue(a.invited_at))[0] || null;
    }

    function contactForStudio(studioId) {
        return M.contactsByStudio(state.contacts)[String(studioId)] || null;
    }

    /* ------------------------------ arranque ------------------------------ */
    document.addEventListener('DOMContentLoaded', async () => {
        setupMobileMenu();
        wireStaticControls();
        const client = await resolveClient();
        if (!client || !M) {
            renderLoadError('No pudimos cargar las invitaciones en este momento.');
            return;
        }
        let session = null;
        try {
            const { data } = await client.auth.getSession();
            session = data && data.session;
        } catch (error) {
            console.warn('[invitaciones] session:', error);
        }
        if (!session) {
            const returnTo = '/artist/invitations' + window.location.search;
            window.location.href = appUrl('/artist/login?returnTo=' + encodeURIComponent(returnTo));
            return;
        }
        state.userId = session.user.id;
        document.getElementById('auth-logout')?.classList.remove('hidden');
        wireLogout(client);
        window.addEventListener('popstate', () => route({ fromHistory: true }));
        await load();
        route({ initial: true });
    });

    // config-manager.js crea el cliente singleton de forma asíncrona (lee la
    // configuración remota): esperamos a que esté listo en vez de crear otro.
    async function resolveClient() {
        const start = Date.now();
        while (Date.now() - start < 6000) {
            const manager = window.ConfigManager;
            const client = (manager && typeof manager.getSupabaseClient === 'function' && manager.getSupabaseClient()) || window._supabase;
            if (client) return client;
            await new Promise((resolve) => setTimeout(resolve, 80));
        }
        return typeof D.getClient === 'function' ? D.getClient() : null;
    }

    function wireLogout(client) {
        const button = document.getElementById('auth-logout');
        if (!button) return;
        button.addEventListener('click', async () => {
            try { await client.auth.signOut(); } catch (error) { console.warn('[invitaciones] logout:', error); }
            window.location.href = appUrl('/artist/login?returnTo=%2Fartist%2Finvitations');
        });
    }

    function setupMobileMenu() {
        const toggle = document.getElementById('inv-mobile-menu-toggle');
        const menu = document.getElementById('inv-mobile-menu');
        if (!toggle || !menu) return;
        const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
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
        document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    }

    async function load() {
        const repo = D.StudioMemberships;
        if (!repo) {
            renderLoadError('No pudimos cargar las invitaciones en este momento.');
            return;
        }
        const safe = async (fn) => {
            try { return (await fn()) || { data: [], error: null }; } catch (error) { return { data: [], error }; }
        };
        const [pending, active, rejected, contacts] = await Promise.all([
            safe(() => repo.listPendingForArtist(state.userId)),
            safe(() => repo.listActiveForArtist(state.userId)),
            safe(() => (typeof repo.listRejectedForArtist === 'function' ? repo.listRejectedForArtist(state.userId) : null)),
            safe(() => (D.Invitations ? D.Invitations.listStudioContacts() : null)),
        ]);
        const firstError = pending.error || active.error || rejected.error;
        if (firstError) {
            renderLoadError(firstError.message || 'No pudimos cargar las invitaciones.');
            state.items = [];
        } else {
            state.items = [
                ...(pending.data || []).map((m) => ({ ...m, _state: 'pending' })),
                ...(active.data || []).map((m) => ({ ...m, _state: 'active' })),
                ...(rejected.data || []).map((m) => ({ ...m, _state: 'rejected' })),
            ];
        }
        state.contacts = contacts.error ? [] : (contacts.data || []);
        state.loaded = true;
        renderHero();
        renderIndex();
        renderList();
    }

    async function refreshContacts() {
        if (!D.Invitations) return state.contacts;
        const result = await D.Invitations.listStudioContacts();
        if (!result.error) state.contacts = result.data || [];
        return state.contacts;
    }

    function renderLoadError(message) {
        const list = document.getElementById('invitations-list');
        if (list) list.innerHTML = `<p class="inv-alert" role="alert">${escapeHtml(message)}</p>`;
    }

    /* ------------------------------- router ------------------------------- */
    const ROUTE_KEYS = ['invitacion', 'drawer', 'vista', 'estudio', 'grupo', 'contactar'];

    function params() { return new URLSearchParams(window.location.search); }

    function navigate(next, options = {}) {
        const url = new URL(window.location.href);
        ROUTE_KEYS.forEach((key) => url.searchParams.delete(key));
        Object.entries(next || {}).forEach(([key, value]) => {
            if (value != null && value !== '') url.searchParams.set(key, value);
        });
        if (window.history && window.history.pushState) {
            if (options.replace) window.history.replaceState(null, '', url);
            else window.history.pushState(null, '', url);
            route({ preserveScroll: options.preserveScroll });
        } else {
            window.location.href = url.toString();
        }
    }

    function hrefFor(next) {
        const url = new URL(window.location.href);
        ROUTE_KEYS.forEach((key) => url.searchParams.delete(key));
        Object.entries(next || {}).forEach(([key, value]) => { if (value != null && value !== '') url.searchParams.set(key, value); });
        return url.pathname + url.search;
    }

    function showView(name) {
        const views = { feed: 'inv-feed-view', detail: 'inv-detail-view', map: 'inv-map-view', studio: 'inv-studio-view' };
        Object.entries(views).forEach(([key, id]) => {
            const node = document.getElementById(id);
            if (node) node.hidden = key !== name;
        });
        document.body.dataset.invView = name;
    }

    function route(options = {}) {
        if (!state.loaded) return;
        const query = params();
        closeDrawer({ restoreFocus: false });
        if (query.get('vista') === 'mapa') {
            window.WoInvitationsStudio?.hide();
            showView('map');
            window.WoInvitationsMap?.show({
                studioId: query.get('estudio'),
                groupIds: (query.get('grupo') || '').split(',').map((id) => id.trim()).filter(Boolean),
            });
        } else if (query.get('estudio')) {
            window.WoInvitationsMap?.hide();
            showView('studio');
            window.WoInvitationsStudio?.show(query.get('estudio'), { contact: query.get('contactar') === '1' });
        } else if (query.get('invitacion')) {
            window.WoInvitationsMap?.hide();
            window.WoInvitationsStudio?.hide();
            const item = findItem(query.get('invitacion'));
            if (!item) { navigate({}, { replace: true }); return; }
            showView('detail');
            renderDetail(item);
            openDrawerFromQuery(item, query.get('drawer'));
        } else {
            window.WoInvitationsMap?.hide();
            window.WoInvitationsStudio?.hide();
            state.current = null;
            showView('feed');
        }
        if (!options.preserveScroll && !options.initial) window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function openDrawerFromQuery(item, drawer) {
        if (drawer === 'cambios' && item._state === 'pending') showChangeRequestDrawer(item, null);
        else if (drawer === 'aceptada' && item._state === 'active') showAcceptedDrawer(item, null);
        else if (drawer === 'rechazada' && item._state === 'rejected') showRejectedDrawer(item, null);
    }

    /* ------------------------------- listado ------------------------------- */
    function wireStaticControls() {
        document.querySelectorAll('#inv-tabs [data-tab]').forEach((button) => {
            button.addEventListener('click', () => {
                state.activeTab = button.dataset.tab;
                document.querySelectorAll('#inv-tabs [data-tab]').forEach((candidate) => {
                    const selected = candidate === button;
                    candidate.classList.toggle('is-active', selected);
                    candidate.setAttribute('aria-selected', String(selected));
                });
                renderList();
            });
        });
        const sort = document.getElementById('inv-sort');
        sort?.addEventListener('change', () => {
            state.sortMode = sort.value;
            sort.classList.toggle('has-value', sort.value !== 'recent');
            renderList();
        });
        document.getElementById('inv-search')?.addEventListener('input', (event) => {
            state.searchTerm = M ? M.normalize(event.target.value) : String(event.target.value || '').toLowerCase();
            renderList();
        });
        document.addEventListener('click', (event) => {
            const link = event.target.closest('[data-inv-nav]');
            if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button > 0) return;
            event.preventDefault();
            const target = link.dataset.invNav;
            if (target === 'map') navigate({ vista: 'mapa' });
            else if (target === 'feed') navigate({});
            else if (target === 'studio') navigate({ estudio: link.dataset.studio });
            else if (target === 'invitation') navigate({ invitacion: link.dataset.invitation });
        });
    }

    function renderHero() {
        const dates = state.items.map(eventDate).map(M.parseDate).filter(Boolean).sort((a, b) => b - a);
        const edition = dates[0] || new Date();
        const eyebrow = document.getElementById('inv-eyebrow');
        if (eyebrow) eyebrow.textContent = `Invitaciones · Edición ${M.MONTHS[edition.getMonth()]} ${edition.getFullYear()}`;
        const count = document.getElementById('inv-count');
        if (count) count.textContent = String(state.items.length).padStart(2, '0');
        const sub = document.getElementById('inv-sub');
        if (sub) sub.textContent = summarySentence();
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

    // Invitación del mes: se elige sobre todas las invitaciones (no sobre lo
    // filtrado), así un filtro o una búsqueda nunca promueve otra pendiente.
    function featuredItem() {
        return M.featuredInvitation(state.items, (item) => detailsOf(item).isFeatured, eventDate);
    }

    function renderIndex() {
        const nav = document.getElementById('inv-index');
        if (!nav) return;
        const ordered = M.indexOrder(state.items, featuredItem(), eventDate);
        nav.innerHTML = ordered.map((membership, index) => {
            const number = String(index + 1).padStart(2, '0');
            const full = studioName(membership);
            return `
            <button type="button" class="inv-index-item" data-open="${escapeHtml(membership.id)}" title="${escapeHtml(full)}" aria-label="${escapeHtml(`${number} ${full}, ${cityOf(membership)}`)}">
                <span class="inv-index-name"><i class="inv-dot inv-dot--${escapeHtml(membership._state)}" aria-hidden="true"></i><span>${number} ${escapeHtml(M.shortStudioName(full))}</span></span>
                <span class="inv-index-city">${escapeHtml(cityOf(membership))}</span>
            </button>`;
        }).join('');
        nav.querySelectorAll('[data-open]').forEach((button) => {
            button.addEventListener('click', () => navigate({ invitacion: button.dataset.open }));
        });
    }

    function visibleItems() {
        let visible = state.items.filter((item) => state.activeTab === 'all' || item._state === state.activeTab);
        if (state.searchTerm) {
            visible = visible.filter((item) => M.normalize(studioName(item)).includes(state.searchTerm)
                || M.normalize(locationText(item)).includes(state.searchTerm));
        }
        return visible;
    }

    function renderList() {
        const list = document.getElementById('invitations-list');
        if (!list || !state.loaded) return;
        const visible = visibleItems();
        if (!visible.length) {
            const filtered = state.items.length > 0;
            list.innerHTML = `<div class="inv-empty"><strong>${filtered ? 'No hay invitaciones con estos filtros' : 'Todavía no hay invitaciones'}</strong><p>${filtered
                ? 'Probá con otra pestaña o borrá la búsqueda.'
                : 'Cuando un estudio te quiera en su roster, la invitación va a aparecer acá. Mientras tanto, explorá el mapa de estudios.'}</p></div>`;
            return;
        }
        // 'Ordenar' por defecto = bloques del Figma; con otro orden, una sola lista
        // ordenada de punta a punta (sin tarjeta del mes).
        const layout = M.listLayout(visible, {
            sortMode: state.sortMode,
            featured: featuredItem(),
            dateOf: eventDate,
            nameOf: studioName,
        });
        const renderByState = (item) => (item._state === 'active' ? renderMember(item)
            : item._state === 'rejected' ? renderRejected(item) : renderRow(item));
        list.innerHTML = [
            layout.feature ? renderFeature(layout.feature) : '',
            ...layout.items.map(renderByState),
        ].join('');
        list.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const { action, id } = button.dataset;
                if (action === 'accept' || action === 'reject') decide(action, id, button);
            });
        });
        list.querySelectorAll('[data-open-card]').forEach((card) => {
            const open = () => navigate({ invitacion: card.dataset.openCard });
            card.addEventListener('click', (event) => {
                if (!event.target.closest('button, a, input, select, textarea')) open();
            });
            card.addEventListener('keydown', (event) => {
                if (event.target !== card) return;
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
            });
        });
    }

    function studioLink(membership, label) {
        const studio = studioOf(membership);
        if (!studio.id) return '';
        return `<a class="inv-link" href="${escapeHtml(hrefFor({ estudio: studio.id }))}" data-inv-nav="studio" data-studio="${escapeHtml(studio.id)}">${escapeHtml(label || 'Ver estudio →')}</a>`;
    }

    function renderFeature(membership) {
        const details = detailsOf(membership);
        const studio = studioOf(membership);
        const photo = M.studioPhotos(studio)[0];
        const when = M.shortDate(eventDate(membership)).toUpperCase();
        const media = photo
            ? `<div class="inv-feature-media" style="background-image:url('${cssUrl(photo)}')" role="img" aria-label="Foto de ${escapeHtml(studioName(membership))}"></div>`
            : `<div class="inv-feature-media inv-photo--empty" aria-hidden="true">${icon('image')}</div>`;
        return `
            <article class="inv-feature" tabindex="0" role="link" aria-label="Ver invitación de ${escapeHtml(studioName(membership))}" data-open-card="${escapeHtml(membership.id)}">
                <div class="inv-feature-body">
                    <div class="inv-feature-top"><span class="inv-feature-eyebrow">Invitación del mes${when ? ` · ${escapeHtml(when)}` : ''}</span><span class="inv-badge inv-badge--accent">Pendiente</span></div>
                    <h2 class="inv-feature-name">${escapeHtml(studioName(membership))}</h2>
                    <span class="inv-feature-meta">${escapeHtml(styleMeta(membership))}</span>
                    ${details.message ? `<div class="inv-quote-row"><span class="inv-quote-mark" aria-hidden="true"></span><p class="inv-quote">${escapeHtml(details.message)}</p></div>` : ''}
                    ${termsLine(membership) ? `<span class="inv-terms">${escapeHtml(termsLine(membership))}</span>` : ''}
                    <div class="inv-feature-actions">
                        <button type="button" class="inv-btn inv-btn--accent" data-action="accept" data-id="${escapeHtml(membership.id)}">${icon('check')} Aceptar</button>
                        <button type="button" class="inv-btn" data-action="reject" data-id="${escapeHtml(membership.id)}">${icon('x')} Rechazar</button>
                        ${studioLink(membership)}
                    </div>
                </div>
                ${media}
            </article>`;
    }

    function renderMember(membership) {
        const details = detailsOf(membership);
        const when = M.shortDate(eventDate(membership)).toUpperCase();
        return `
            <article class="inv-member" tabindex="0" role="link" aria-label="Ver invitación de ${escapeHtml(studioName(membership))}" data-open-card="${escapeHtml(membership.id)}">
                <div>
                    <span class="inv-member-eyebrow">Miembro del roster${when ? ` · ${escapeHtml(when)}` : ''}</span>
                    <h3 class="inv-member-name">${escapeHtml(studioName(membership))}</h3>
                    <span class="inv-member-meta">${escapeHtml(styleMeta(membership))}</span>
                </div>
                <div class="inv-member-side">
                    ${details.message ? `<p class="inv-member-quote">“${escapeHtml(details.message)}”</p>` : ''}
                    ${studioLink(membership)}
                </div>
            </article>`;
    }

    function renderRow(membership) {
        const details = detailsOf(membership);
        return `
            <article class="inv-row" tabindex="0" role="link" aria-label="Ver invitación de ${escapeHtml(studioName(membership))}" data-open-card="${escapeHtml(membership.id)}">
                <span class="inv-row-date">${escapeHtml(M.shortDate(eventDate(membership)).toUpperCase() || PLACEHOLDER)}</span>
                <h3 class="inv-row-name${studioName(membership).length > 16 ? ' inv-row-name--long' : ''}">${escapeHtml(studioName(membership))}</h3>
                <span class="inv-row-meta">${escapeHtml(styleMeta(membership))}</span>
                <p class="inv-row-quote">${details.message ? `“${escapeHtml(details.message)}”` : ''}</p>
                <span class="inv-badge inv-badge--pending inv-row-badge">Pendiente</span>
                <div class="inv-row-actions">
                    <button type="button" class="inv-btn inv-btn--ink inv-btn--row" data-action="accept" data-id="${escapeHtml(membership.id)}">Aceptar</button>
                    <button type="button" class="inv-btn inv-btn--row" data-action="reject" data-id="${escapeHtml(membership.id)}">Rechazar</button>
                </div>
            </article>`;
    }

    function renderRejected(membership) {
        const name = studioName(membership);
        const meta = [cityOf(membership)].concat(detailsOf(membership).styles, M.shortDate(eventDate(membership)).toUpperCase()).filter(Boolean).join(' · ');
        return `
            <article class="inv-rejected" data-id="${escapeHtml(membership.id)}">
                <div class="inv-rejected-id">
                    <span class="inv-rejected-avatar" aria-hidden="true">${escapeHtml(M.initials(name))}</span>
                    <a class="inv-rejected-name" href="${escapeHtml(hrefFor({ invitacion: membership.id }))}" data-inv-nav="invitation" data-invitation="${escapeHtml(membership.id)}">${escapeHtml(name)}</a>
                    <span class="inv-rejected-meta">${escapeHtml(meta)}</span>
                </div>
                <div class="inv-rejected-side"><span class="inv-rejected-status-label">Rechazada</span>${studioLink(membership)}</div>
            </article>`;
    }

    /* ------------------------------- detalle ------------------------------- */
    function stepperHtml(itemState) {
        const steps = ['Invitación recibida', 'En revisión', 'Respondida', 'Confirmada'];
        const reached = itemState === 'active' ? 4 : 3;
        return `<div class="inv-stepper" role="list" aria-label="Progreso de la invitación">${steps.map((label, index) => {
            const number = index + 1;
            const done = number < reached || (itemState === 'active' && number === 4);
            const current = number === reached && itemState !== 'active';
            const line = index ? `<span class="inv-step-line ${number <= reached ? 'is-done' : ''}" aria-hidden="true"></span>` : '';
            return `${line}<span class="inv-step ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}" role="listitem"${current ? ' aria-current="step"' : ''}><span class="inv-step-dot">${done ? icon('check') : number}</span><span>${escapeHtml(label)}</span></span>`;
        }).join('')}</div>`;
    }

    function galleryHtml(membership) {
        const photos = M.studioPhotos(studioOf(membership));
        return `<div class="inv-detail-gallery">${Array.from({ length: 4 }, (_, index) => {
            const photo = photos[index];
            return photo
                ? `<span class="inv-photo" style="background-image:url('${cssUrl(photo)}')" role="img" aria-label="Foto ${index + 1} de ${escapeHtml(studioName(membership))}"></span>`
                : `<span class="inv-photo inv-photo--empty">${icon('image')}<span>Foto ${index + 1}</span></span>`;
        }).join('')}</div>`;
    }

    function stateLabel(itemState) {
        if (itemState === 'active') return 'Invitación aceptada';
        if (itemState === 'rejected') return 'Invitación rechazada';
        return 'Invitación recibida';
    }

    function offerPanel(membership) {
        const details = detailsOf(membership);
        const start = M.dayMonth(details.startDate);
        const cells = [
            ['Fechas propuestas', start ? `Incorporación a partir del ${start}` : 'A coordinar con el estudio'],
            ['Duración', details.duration || 'A coordinar'],
            ['Split para vos', details.split != null ? `${Math.round(details.split)}% para el artista` : 'A coordinar'],
            ['Stipend / beneficios', details.benefits.length ? details.benefits.join(' · ') : 'Sin beneficios publicados'],
        ];
        const columns = [
            ['Qué incluye el estudio', details.provides],
            ['Qué espera del artista', details.expectations],
            ['Requisitos', details.requirements],
        ].filter(([, values]) => values.length);
        return `
            <div class="inv-offer-grid">${cells.map(([key, value]) => `<div class="inv-offer-cell"><span class="inv-key">${escapeHtml(key)}</span><span class="inv-offer-value">${escapeHtml(value)}</span></div>`).join('')}</div>
            ${columns.length ? `<div class="inv-detail-bullets">${columns.map(([title, values]) => `<section><span class="inv-key">${escapeHtml(title)}</span><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>`).join('')}</div>` : ''}`;
    }

    function infoPanel(membership) {
        const details = detailsOf(membership);
        const location = locationOf(membership);
        const rows = [
            ['Invitación enviada', M.longDate(membership.invited_at) || PLACEHOLDER],
            ['Fecha límite', M.longDate(details.responseDueAt) || 'Sin fecha límite'],
            ['Rol propuesto', membership.role === 'guest' ? 'Guest artist' : membership.role === 'manager' ? 'Manager' : 'Artista residente'],
            ['Sede', [location.label, location.formatted_address || locationText(membership)].filter(Boolean).join(' · ') || PLACEHOLDER],
        ];
        if (details.contactName || details.contactEmail) {
            rows.push(['Contacto', `${escapeHtml(details.contactName || 'Estudio')}${details.contactTitle ? `<small>${escapeHtml(details.contactTitle)}</small>` : ''}${details.contactEmail ? `<small><a href="mailto:${escapeHtml(details.contactEmail)}">${escapeHtml(details.contactEmail)}</a></small>` : ''}`, true]);
        }
        return `<dl class="inv-info-list">${rows.map(([key, value, html]) => `<div><dt class="inv-key">${escapeHtml(key)}</dt><dd>${html ? value : escapeHtml(value)}</dd></div>`).join('')}</dl>`;
    }

    function detailMain(membership) {
        const studio = studioOf(membership);
        const details = detailsOf(membership);
        const instagram = M.text(studio.instagram).replace(/^@/, '');
        const website = M.text(studio.website);
        const description = M.text(studio.bio) || M.text(studio.tagline);
        const tab = state.detailTab;
        const contactInitials = M.initials(details.contactName || studioName(membership));
        return `
            <div class="inv-detail-kicker">
                <span class="inv-detail-status inv-detail-status--${escapeHtml(membership._state)}">${escapeHtml(stateLabel(membership._state))}</span>
                ${locationText(membership) ? `<span class="inv-detail-place">${icon('map-pin')}${escapeHtml(locationText(membership))}</span>` : ''}
            </div>
            <h1 class="inv-detail-title">${escapeHtml(studioName(membership))}</h1>
            ${galleryHtml(membership)}
            ${description ? `<p class="inv-detail-desc">${escapeHtml(description)}</p>` : ''}
            <div class="inv-detail-links">
                ${instagram ? `<a href="https://instagram.com/${encodeURIComponent(instagram)}" target="_blank" rel="noopener">${icon('instagram')}@${escapeHtml(instagram)}</a>` : ''}
                ${website ? `<a href="${escapeHtml(/^https?:\/\//.test(website) ? website : 'https://' + website)}" target="_blank" rel="noopener">${icon('external-link')}${escapeHtml(website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : ''}
                <span id="inv-roster" hidden>${icon('users')}<span></span></span>
            </div>
            ${details.styles.length ? `<div class="inv-chips">${details.styles.map((style) => `<span class="inv-chip">${escapeHtml(style)}</span>`).join('')}</div>` : ''}
            <div class="inv-detail-tabs" role="tablist" aria-label="Información de la invitación">
                <button type="button" class="inv-detail-tab ${tab === 'roster' ? 'is-active' : ''}" role="tab" id="inv-tab-roster" aria-controls="inv-panel" aria-selected="${tab === 'roster'}" data-detail-tab="roster">Roster</button>
                <button type="button" class="inv-detail-tab ${tab === 'details' ? 'is-active' : ''}" role="tab" id="inv-tab-details" aria-controls="inv-panel" aria-selected="${tab === 'details'}" data-detail-tab="details">Detalles de la invitación</button>
            </div>
            <div id="inv-panel" role="tabpanel" aria-labelledby="inv-tab-${tab === 'roster' ? 'roster' : 'details'}">${tab === 'roster' ? offerPanel(membership) : infoPanel(membership)}</div>
            ${details.message ? `<section class="inv-message-card">
                <span class="inv-key">Mensaje del estudio</span>
                <blockquote>“${escapeHtml(details.message)}”</blockquote>
                ${details.contactName ? `<div class="inv-message-person"><span class="inv-message-avatar" aria-hidden="true">${escapeHtml(contactInitials)}</span><strong>${escapeHtml(details.contactName)}</strong>${details.contactTitle ? `<span>— ${escapeHtml(details.contactTitle)}</span>` : ''}</div>` : ''}
            </section>` : ''}`;
    }

    function detailAside(membership) {
        const details = detailsOf(membership);
        const studio = studioOf(membership);
        const sub = membership._state === 'pending'
            ? 'El estudio te seleccionó. Revisá las condiciones y respondé.'
            : membership._state === 'active'
                ? 'Ya formás parte del roster de este estudio.'
                : 'Rechazaste esta invitación. El estudio puede volver a invitarte.';
        let actions = '';
        if (membership._state === 'pending') {
            actions = `
                <button type="button" class="inv-aside-btn inv-aside-btn--primary" data-action="accept" data-id="${escapeHtml(membership.id)}">${icon('check')} Aceptar invitación</button>
                <button type="button" class="inv-aside-btn inv-aside-btn--outline" data-action="contact" data-id="${escapeHtml(membership.id)}">${icon('message-circle')} Contactar al estudio</button>
                <button type="button" class="inv-aside-btn" data-action="request-changes" data-id="${escapeHtml(membership.id)}">${icon('edit')} Solicitar cambios</button>
                <button type="button" class="inv-aside-btn" data-action="reject" data-id="${escapeHtml(membership.id)}">${icon('x')} Rechazar invitación</button>`;
        } else {
            actions = `
                <button type="button" class="inv-aside-btn inv-aside-btn--outline" data-action="contact" data-id="${escapeHtml(membership.id)}">${icon('message-circle')} Contactar al estudio</button>
                ${studio.id ? `<a class="inv-aside-btn" href="${escapeHtml(hrefFor({ estudio: studio.id }))}" data-inv-nav="studio" data-studio="${escapeHtml(studio.id)}">Ver estudio ${icon('arrow-right')}</a>` : ''}
                ${membership._state === 'active' ? `<button type="button" class="inv-aside-btn" data-action="leave" data-id="${escapeHtml(membership.id)}">${icon('log-out')} Salir del roster</button>` : ''}`;
        }
        return `
            <h2 class="inv-aside-title">Resumen de la invitación</h2>
            <p class="inv-aside-sub">${escapeHtml(sub)}</p>
            <div class="inv-aside-rows">
                <div class="inv-aside-row"><span class="inv-key">Estado</span><span class="inv-detail-status inv-detail-status--${escapeHtml(membership._state)}">${escapeHtml(stateLabel(membership._state))}</span></div>
                <div class="inv-aside-row"><span class="inv-key">Fecha límite</span><span class="inv-aside-value">${escapeHtml(M.longDate(details.responseDueAt) || 'Sin fecha límite')}</span></div>
                <div class="inv-aside-row"><span class="inv-key">Contacto</span><span class="inv-aside-value">${escapeHtml(details.contactName || studioName(membership))}</span></div>
            </div>
            ${membership._state === 'pending' && details.steps.length ? `<section class="inv-aside-section"><span class="inv-key">Si aceptás</span><ul class="inv-accept-list">${details.steps.map((step) => `<li>${icon('arrow-right')}<span>${escapeHtml(step)}</span></li>`).join('')}</ul></section>` : ''}
            <div class="inv-aside-actions">${actions}</div>`;
    }

    function renderDetail(membership) {
        const view = document.getElementById('inv-detail-view');
        if (!view || !membership) return;
        if (!state.current || state.current.id !== membership.id) state.detailTab = 'roster';
        state.current = membership;
        view.innerHTML = `
            <div class="inv-detail-header">
                <a class="inv-detail-back" href="${escapeHtml(hrefFor({}))}" data-inv-nav="feed">${icon('arrow-left')} Volver a invitaciones</a>
                ${stepperHtml(membership._state)}
            </div>
            <div class="inv-detail-main">${detailMain(membership)}</div>
            <aside class="inv-detail-aside" aria-label="Resumen de la invitación">${detailAside(membership)}</aside>`;
        view.querySelectorAll('[data-detail-tab]').forEach((button) => {
            button.addEventListener('click', () => {
                state.detailTab = button.dataset.detailTab;
                renderDetail(membership);
                view.querySelector(`[data-detail-tab="${state.detailTab}"]`)?.focus();
            });
            button.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                event.preventDefault();
                state.detailTab = state.detailTab === 'roster' ? 'details' : 'roster';
                renderDetail(membership);
                view.querySelector(`[data-detail-tab="${state.detailTab}"]`)?.focus();
            });
        });
        view.querySelectorAll('.inv-aside-actions [data-action]').forEach((button) => {
            button.addEventListener('click', () => {
                const { action, id } = button.dataset;
                if (action === 'request-changes') showChangeRequestDrawer(membership, button);
                else if (action === 'contact') openContact(membership, button);
                else if (action === 'leave') leave(id, button);
                else decide(action, id, button);
            });
        });
        loadRosterCount(membership);
    }

    async function loadRosterCount(membership) {
        const studioId = studioOf(membership).id;
        if (!studioId || !D.Invitations) return;
        const { data, error } = await D.Invitations.listStudioRoster(studioId);
        if (error || !Array.isArray(data) || !data.length || state.current?.id !== membership.id) return;
        const roster = document.getElementById('inv-roster');
        if (!roster) return;
        roster.querySelector('span').textContent = `${data.length} artista${data.length === 1 ? '' : 's'} residente${data.length === 1 ? '' : 's'}`;
        roster.hidden = false;
    }

    function openContact(membership, trigger) {
        const studio = studioOf(membership);
        if (!window.WoInvitationsStudio || !studio.id) return;
        window.WoInvitationsStudio.openContact({
            studioId: studio.id,
            studioName: studioName(membership),
            reason: membership.role === 'guest' ? 'guest_spot' : 'resident',
            trigger,
        });
    }

    /* ------------------------------ acciones ------------------------------ */
    async function decide(action, membershipId, trigger) {
        if (action !== 'accept' && action !== 'reject') return;
        const membership = findItem(membershipId);
        if (!membership || !D.StudioMemberships) return;
        setBusy(trigger, true);
        let result;
        try {
            result = await D.StudioMemberships.respondToInvitation(membershipId, state.userId, action);
        } catch (error) {
            result = { error };
        }
        setBusy(trigger, false);
        const error = (result && result.error) || (result && result.data && result.data.success === false ? { message: result.data.message } : null);
        if (error) { showInlineError(trigger, error.message || 'No pudimos registrar tu respuesta.'); return; }
        document.dispatchEvent(new CustomEvent('weotzi:invitation-response', {
            detail: { membershipId, action, studioId: studioOf(membership).id || null },
        }));
        await load();
        const updated = findItem(membershipId) || { ...membership, _state: action === 'accept' ? 'active' : 'rejected' };
        navigate({}, { replace: !!params().get('invitacion') });
        if (action === 'accept') showAcceptedDrawer(updated, trigger);
        else showRejectedDrawer(updated, trigger);
    }

    async function leave(membershipId, trigger) {
        if (!window.confirm('¿Salir del roster de este estudio? Tu perfil personal queda intacto.')) return;
        setBusy(trigger, true);
        let result;
        try { result = await D.StudioMemberships.endMembership(membershipId); } catch (error) { result = { error }; }
        setBusy(trigger, false);
        if (result && result.error) { showInlineError(trigger, result.error.message); return; }
        await load();
        navigate({}, { replace: true });
    }

    /* ------------------------------- drawers ------------------------------- */
    function showAcceptedDrawer(membership, trigger) {
        const details = detailsOf(membership);
        openDrawer(`
            <aside class="inv-drawer inv-drawer--accepted" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title" tabindex="-1">
                <button type="button" class="inv-drawer-close" data-drawer-close aria-label="Cerrar">${icon('x')}</button>
                <h2 class="inv-drawer-heading" id="inv-drawer-title"><span class="inv-drawer-icon">${icon('check')}</span>Invitación aceptada</h2>
                <div class="inv-drawer-status" role="status">${icon('check-circle')}<div><strong>¡Bienvenido al equipo!</strong><p>${escapeHtml(studioName(membership))} te va a contactar para coordinar los próximos pasos.</p></div></div>
                ${details.contactName || details.contactEmail ? `<div class="inv-contact-block"><span class="inv-key">Datos de contacto</span>${details.contactName ? `<strong>${escapeHtml(details.contactName)}</strong>` : ''}${details.contactEmail ? `<a href="mailto:${escapeHtml(details.contactEmail)}">${icon('mail')}${escapeHtml(details.contactEmail)}</a>` : ''}</div>` : ''}
            </aside>`, trigger);
    }

    function showRejectedDrawer(membership, trigger) {
        openDrawer(`
            <aside class="inv-drawer inv-drawer--rejected" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title" tabindex="-1">
                <div class="inv-rejected-status" role="status">${icon('alert-circle')}<div><strong id="inv-drawer-title">Invitación rechazada</strong><p>Le avisamos a ${escapeHtml(studioName(membership))} que no vas a sumarte esta vez.</p></div></div>
                <button class="inv-other-invitations" type="button" data-other-invitations>Ver otras invitaciones ${icon('arrow-right')}</button>
            </aside>`, trigger);
        // Abierto desde el detalle (?invitacion=…&drawer=rechazada) vuelve al listado;
        // desde Rechazar ya estamos en el listado y solo cierra.
        document.querySelector('#inv-drawer-layer [data-other-invitations]')?.addEventListener('click', () => {
            const onDetail = !!params().get('invitacion');
            closeDrawer({ restoreFocus: !onDetail });
            if (onDetail) navigate({});
        });
    }

    function showChangeRequestDrawer(membership, trigger) {
        openDrawer(`
            <aside class="inv-drawer inv-drawer--change" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title" tabindex="-1">
                <h2 class="inv-drawer-heading" id="inv-drawer-title">Solicitar cambios</h2>
                <p class="inv-change-copy">Contale al estudio qué te gustaría ajustar antes de aceptar.</p>
                <form class="inv-change-form" id="inv-change-form" novalidate>
                    <label class="inv-key" for="inv-change-message">Tu propuesta de cambios</label>
                    <textarea class="inv-change-textarea" id="inv-change-message" name="message" required maxlength="2000" placeholder="Ej: ¿podríamos mover las fechas dos semanas y subir el split a 45/55?"></textarea>
                    <p class="inv-drawer-error" id="inv-change-error" role="alert" hidden></p>
                    <div class="inv-change-actions">
                        <button class="inv-change-submit" type="submit">Enviar propuesta ${icon('send')}</button>
                        <button class="inv-aside-btn" type="button" data-drawer-close>Volver</button>
                    </div>
                </form>
            </aside>`, trigger);
        const form = document.getElementById('inv-change-form');
        const textarea = document.getElementById('inv-change-message');
        textarea?.focus();
        form?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const message = textarea.value.trim();
            const errorEl = document.getElementById('inv-change-error');
            const submit = form.querySelector('[type="submit"]');
            const fail = (text) => { errorEl.textContent = text; errorEl.hidden = false; };
            if (!message) { fail('Escribí los cambios que querés proponer.'); textarea.focus(); return; }
            const repo = D.StudioMemberships;
            if (!repo || typeof repo.requestChanges !== 'function') { fail('La propuesta no está disponible en este momento.'); return; }
            setBusy(submit, true);
            let result;
            try { result = await D.StudioMemberships.requestChanges(membership.id, state.userId, message); } catch (error) { result = { error }; }
            setBusy(submit, false);
            if (result && result.error) { fail(result.error.message || 'No pudimos enviar tu propuesta.'); return; }
            document.dispatchEvent(new CustomEvent('weotzi:invitation-change-requested', {
                detail: { membershipId: membership.id, studioId: studioOf(membership).id || null },
            }));
            form.outerHTML = `<p class="inv-drawer-done" role="status">Le enviamos tu propuesta a ${escapeHtml(studioName(membership))}. Te avisamos cuando responda.</p>
                <button class="inv-aside-btn inv-aside-btn--outline" type="button" data-drawer-close>Volver</button>`;
            document.querySelectorAll('#inv-drawer-layer [data-drawer-close]').forEach((button) => button.addEventListener('click', () => closeDrawer()));
            document.querySelector('#inv-drawer-layer [data-drawer-close]')?.focus();
        });
    }

    function openDrawer(content, trigger) {
        closeDrawer({ restoreFocus: false });
        state.returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
        const layer = document.createElement('div');
        layer.className = 'inv-drawer-layer';
        layer.id = 'inv-drawer-layer';
        layer.innerHTML = `<div class="inv-drawer-scrim" data-drawer-close aria-hidden="true"></div>${content}`;
        document.body.appendChild(layer);
        document.body.classList.add('inv-drawer-open');
        layer.querySelectorAll('[data-drawer-close]').forEach((button) => button.addEventListener('click', () => closeDrawer()));
        layer.addEventListener('keydown', trapFocus);
        document.addEventListener('keydown', escapeHandler);
        layer.querySelector('[role="dialog"]')?.focus({ preventScroll: true });
    }

    function escapeHandler(event) { if (event.key === 'Escape') closeDrawer(); }

    function trapFocus(event) {
        if (event.key !== 'Tab') return;
        const focusable = [...event.currentTarget.querySelectorAll('button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), select:not([disabled])')];
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
        document.removeEventListener('keydown', escapeHandler);
        const query = params();
        if (query.get('drawer')) {
            const url = new URL(window.location.href);
            url.searchParams.delete('drawer');
            window.history.replaceState(null, '', url);
        }
        if (options.restoreFocus !== false && state.returnFocus && state.returnFocus.isConnected) state.returnFocus.focus();
        state.returnFocus = null;
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
        error.className = 'inv-alert inv-action-error';
        error.setAttribute('role', 'alert');
        error.textContent = message || 'No pudimos completar la acción.';
        host.appendChild(error);
    }

    // API compartida con invitations-map.js e invitations-studio.js.
    window.WoInvitationsApp = {
        appUrl,
        escapeHtml,
        cssUrl,
        icon,
        navigate,
        hrefFor,
        refreshContacts,
        membershipForStudio,
        contactForStudio,
        getItems: () => state.items.slice(),
        getContacts: () => state.contacts.slice(),
        get userId() { return state.userId; },
    };
})();
