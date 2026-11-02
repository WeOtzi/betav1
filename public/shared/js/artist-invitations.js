// ================================================================
// WE OTZI - INVITACIONES DEL ARTISTA (/artist/invitations)
// Figma final del flujo de artista (oct 2026), archivo w3JA83CcP5ISKjyOu87mx1:
//   801:540  listado · 801:541 detalle y condiciones
//   801:1101 solicitar cambios · 801:1102 aceptada · 801:1103 rechazada
//   2007:5792/5793 mapa (invitations-map.js) · 2007:5794 estudio y
//   2007:5795 escribir al estudio (invitations-studio.js)
// Plataforma de Estudios (docs/plans/2026-10-30-estudios-plataforma.md):
//   solicitudes de alta enviadas por el artista (retirar), contratos por
//   firmar (firmar / rechazar), contrato vigente (rescindir) y materiales
//   entregados de cada membresía activa.
//
// Rutas internas (parámetros de URL, también útiles para QA):
//   ?invitacion=<membership_id>[&drawer=cambios|aceptada|rechazada]
//   ?contrato=<contract_id>[&drawer=firmar|rechazar|rescindir]
//   ?vista=mapa[&estudio=<studio_id>][&grupo=<studio_id>,<studio_id>…]
//   ?estudio=<studio_id>[&contactar=1][&solicitar=1]
// Datos: WeotziData.StudioMemberships (+ invitation_details embebido),
// WeotziData.StudioContracts (studio-contracts-repo.js), WeotziData.StudioOps
// (materiales) y WeotziData.Invitations (invitations-repo.js). Sin las
// migraciones nuevas, solicitudes, contratos y materiales quedan vacíos.
// ================================================================

(function () {
    'use strict';

    const M = window.WoInvitationsModel;
    const D = window.WeotziData || {};
    const PLACEHOLDER = '—';
    // Estados de studio_artist_memberships que lista la página (las
    // solicitudes 'requested' llegan aparte, con el dueño del estudio).
    const MEMBERSHIP_STATUSES = ['pending_invite', 'pending_acceptance', 'active', 'paused', 'rejected'];
    const CONTRACT_STATUSES = ['sent', 'signed', 'declined', 'cancelled', 'terminated', 'expired'];
    const NOTIFY_PATH = '/api/artist/studio-notify';

    const state = {
        client: null,
        userId: null,
        items: [],
        contacts: [],
        contracts: [],
        materials: null,
        materialsUnavailable: false,
        loaded: false,
        activeTab: 'all',
        sortMode: 'recent',
        searchTerm: '',
        detailTab: 'roster',
        current: null,
        currentContract: null,
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

    // href/src armados con datos: solo http(s) (WeOtziStudioKit.safeUrl si está).
    function safeUrl(value) {
        const kit = window.WeOtziStudioKit;
        return kit && typeof kit.safeUrl === 'function' ? kit.safeUrl(value) : M.safeUrl(value);
    }

    function studioOf(membership) { return (membership && (membership.studios || membership.studio)) || {}; }
    function studioName(membership) { return studioOf(membership).name || 'Estudio'; }
    function locationOf(membership) { return (membership && membership.location) || {}; }
    function isRequest(membership) { return M.initiatedBy(membership) === 'artist'; }

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
        const styles = isRequest(membership) ? M.requestDetails(membership).styles : detailsOf(membership).styles;
        return [cityOf(membership)].concat(styles).filter(Boolean).join(' · ');
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

    function findContract(id) { return state.contracts.find((contract) => String(contract.id) === String(id)) || null; }

    // Contrato `sent` de la membresía: reemplaza "Aceptar" por "Revisar y firmar".
    function pendingContractOf(membership) { return M.pendingContractFor(state.contracts, membership && membership.id); }

    function currentContractOf(membership) {
        return membership && membership._state === 'active' ? M.currentContractFor(state.contracts, membership) : null;
    }

    function membershipForStudio(studioId) {
        const rows = state.items.filter((item) => String(studioOf(item).id || item.studio_id) === String(studioId));
        return rows.sort((a, b) => M.dateValue(b.invited_at) - M.dateValue(a.invited_at))[0] || null;
    }

    // Vínculo abierto con el estudio (solicitud enviada, invitación pendiente o
    // membresía activa) de cualquier rol: request_studio_membership rechaza
    // pedir el alta si existe uno, así que "Solicitar alta" no se ofrece.
    function openMembershipForStudio(studioId) {
        return state.items.find((item) => String(studioOf(item).id || item.studio_id) === String(studioId)
            && ['requested', 'pending', 'active'].includes(item._state)) || null;
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
        state.client = client;
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

    async function safeCall(fn) {
        try { return (await fn()) || { data: [], error: null }; } catch (error) { return { data: [], error }; }
    }

    // Invitaciones y vínculos del artista. listForArtistV2 suma initiated_by y
    // current_contract_id (con fallback propio); sin él, los listados de siempre.
    async function loadMemberships(repo) {
        if (typeof repo.listForArtistV2 === 'function') {
            return safeCall(() => repo.listForArtistV2(state.userId, { status: MEMBERSHIP_STATUSES }));
        }
        const [pending, active, rejected] = await Promise.all([
            safeCall(() => repo.listPendingForArtist(state.userId)),
            safeCall(() => repo.listActiveForArtist(state.userId)),
            safeCall(() => (typeof repo.listRejectedForArtist === 'function' ? repo.listRejectedForArtist(state.userId) : null)),
        ]);
        return {
            data: [].concat(pending.data || [], active.data || [], rejected.data || []),
            error: pending.error || active.error || rejected.error || null,
        };
    }

    // Contratos del artista (la RLS oculta los borradores). Antes de listar se
    // vencen los `sent` pasados de fecha. Sin la migración: lista vacía.
    async function loadContracts() {
        const C = D.StudioContracts;
        if (!C || typeof C.listForArtist !== 'function') return [];
        if (typeof C.expireOverdue === 'function') {
            const expired = await safeCall(() => C.expireOverdue(null));
            if (expired.error && !M.isMissingSchema(expired.error)) console.warn('[invitaciones] contratos vencidos:', expired.error);
        }
        const result = await safeCall(() => C.listForArtist(state.userId, { status: CONTRACT_STATUSES }));
        if (result.error) {
            if (!M.isMissingSchema(result.error)) console.warn('[invitaciones] contratos:', result.error);
            return [];
        }
        return Array.isArray(result.data) ? result.data : [];
    }

    function decorate(membership) {
        const detail = M.artistState(membership);
        return { ...membership, _detail: detail, _state: M.stateGroup(detail) };
    }

    async function load() {
        const repo = D.StudioMemberships;
        if (!repo) {
            renderLoadError('No pudimos cargar las invitaciones en este momento.');
            return;
        }
        const [memberships, requests, contracts, contacts] = await Promise.all([
            loadMemberships(repo),
            safeCall(() => (typeof repo.listRequestsForArtist === 'function' ? repo.listRequestsForArtist(state.userId) : null)),
            loadContracts(),
            safeCall(() => (D.Invitations ? D.Invitations.listStudioContacts() : null)),
        ]);
        if (memberships.error) {
            renderLoadError(memberships.error.message || 'No pudimos cargar las invitaciones.');
            state.items = [];
        } else {
            if (requests.error) console.warn('[invitaciones] solicitudes:', requests.error);
            const requested = (requests.error ? [] : (requests.data || []))
                .map((row) => decorate({ ...row, initiated_by: row.initiated_by || 'artist' }));
            const seen = new Set(requested.map((row) => String(row.id)));
            state.items = (memberships.data || [])
                .filter((row) => row && !seen.has(String(row.id)))
                .map(decorate)
                .concat(requested);
        }
        state.contracts = contracts;
        state.materials = null;
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

    // Avisa al dueño del estudio (POST /api/artist/studio-notify con el Bearer
    // de la sesión). Nunca lanza: si el aviso falla, la acción ya quedó guardada.
    async function notifyStudio(kind, payload) {
        const body = { kind, ...(payload || {}) };
        try {
            const kit = window.WeOtziStudioKit;
            if (kit && typeof kit.postNotify === 'function') return await kit.postNotify(NOTIFY_PATH, body, state.client);
            let token = null;
            try {
                const { data } = await state.client.auth.getSession();
                token = data && data.session ? data.session.access_token : null;
            } catch (_) { token = null; }
            const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
            if (token) headers.Authorization = 'Bearer ' + token;
            const response = await fetch(appUrl(NOTIFY_PATH), { method: 'POST', headers, body: JSON.stringify(body) });
            let data = null;
            try { data = await response.json(); } catch (_) { data = null; }
            return { ok: response.ok && !(data && data.success === false), data };
        } catch (error) {
            console.warn('[invitaciones] aviso al estudio:', error);
            return { ok: false, data: null, error };
        }
    }

    /* ------------------------------- router ------------------------------- */
    const ROUTE_KEYS = ['invitacion', 'contrato', 'drawer', 'vista', 'estudio', 'grupo', 'contactar', 'solicitar'];

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
        state.currentContract = null;
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
            window.WoInvitationsStudio?.show(query.get('estudio'), {
                contact: query.get('contactar') === '1',
                request: query.get('solicitar') === '1',
            });
        } else if (query.get('contrato')) {
            window.WoInvitationsMap?.hide();
            window.WoInvitationsStudio?.hide();
            state.current = null;
            showView('detail');
            openContractRoute(query.get('contrato'), query.get('drawer'));
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
        else if (drawer === 'rechazada' && item._detail === 'rejected_by_artist') showRejectedDrawer(item, null);
    }

    // ?contrato=<id>: primero el listado ya cargado; si no está (p. ej. llegó
    // desde un email), se pide por id. La RLS solo le muestra al artista sus
    // contratos que no son borradores.
    async function openContractRoute(contractId, drawer) {
        let contract = findContract(contractId);
        if (!contract && D.StudioContracts && typeof D.StudioContracts.get === 'function') {
            const view = document.getElementById('inv-detail-view');
            if (view) view.innerHTML = '<p class="inv-loading">Cargando contrato…</p>';
            const result = await safeCall(() => D.StudioContracts.get(contractId));
            if (params().get('contrato') !== contractId) return;
            contract = result.error ? null : result.data;
            if (contract) state.contracts = state.contracts.concat(contract);
        }
        if (!contract) {
            navigate({}, { replace: true });
            return;
        }
        renderContract(contract);
        const status = M.contractState(contract);
        if (drawer === 'firmar' && status === 'sent') showSignDrawer(contract, null);
        else if (drawer === 'rechazar' && status === 'sent') showDeclineDrawer(contract, null);
        else if (drawer === 'rescindir' && status === 'signed') showTerminateDrawer(contract, null);
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
            else if (target === 'contract') navigate({ contrato: link.dataset.contract });
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
        const requested = countBy('requested');
        const toSign = M.contractsToSign(state.contracts).length;
        const parts = [];
        if (toSign) parts.push(`${toSign} ${toSign === 1 ? 'contrato espera' : 'contratos esperan'} tu firma`);
        if (pending) parts.push(`${pending} ${pending === 1 ? 'espera' : 'esperan'} tu respuesta`);
        if (requested) parts.push(`${requested} ${requested === 1 ? 'solicitud espera' : 'solicitudes esperan'} al estudio`);
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

    // "Pendientes" junta lo que espera respuesta: tus invitaciones y tus solicitudes.
    function matchesTab(item) {
        if (state.activeTab === 'all' || item._state === state.activeTab) return true;
        return state.activeTab === 'pending' && item._state === 'requested';
    }

    function matchesSearch(name, place) {
        if (!state.searchTerm) return true;
        return M.normalize(name).includes(state.searchTerm) || M.normalize(place).includes(state.searchTerm);
    }

    function visibleItems() {
        return state.items.filter(matchesTab).filter((item) => matchesSearch(studioName(item), locationText(item)));
    }

    function visibleContracts() {
        if (state.activeTab !== 'all' && state.activeTab !== 'pending') return [];
        return M.contractsToSign(state.contracts).filter((contract) => {
            const studio = contract.studios || {};
            return matchesSearch(studio.name, [studio.city, studio.country].filter(Boolean).join(', '));
        });
    }

    function renderList() {
        const list = document.getElementById('invitations-list');
        if (!list || !state.loaded) return;
        const visible = visibleItems();
        const contractsHtml = renderContractsBlock(visibleContracts());
        if (!visible.length && !contractsHtml) {
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
            : item._state === 'rejected' ? renderRejected(item)
                : item._state === 'requested' ? renderRequest(item) : renderRow(item));
        list.innerHTML = [
            contractsHtml,
            layout.feature ? renderFeature(layout.feature) : '',
            ...layout.items.map(renderByState),
        ].join('');
        list.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const { action, id } = button.dataset;
                if (action === 'accept' || action === 'reject') decide(action, id, button);
                else if (action === 'withdraw') withdrawRequest(id, button);
            });
        });
        list.querySelectorAll('[data-open-card], [data-open-contract]').forEach((card) => {
            const open = () => (card.dataset.openContract
                ? navigate({ contrato: card.dataset.openContract })
                : navigate({ invitacion: card.dataset.openCard }));
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

    // Una invitación (o solicitud) con contrato enviado se responde firmándolo.
    function contractLink(contract, className, label) {
        return `<a class="${className}" href="${escapeHtml(hrefFor({ contrato: contract.id }))}" data-inv-nav="contract" data-contract="${escapeHtml(contract.id)}">${icon('edit')} ${escapeHtml(label || 'Revisar y firmar contrato')}</a>`;
    }

    function renderContractsBlock(contracts) {
        if (!contracts.length) return '';
        return `
            <section class="inv-contracts" aria-labelledby="inv-contracts-title">
                <h2 class="inv-contracts-title" id="inv-contracts-title"><span>Contratos por firmar</span><span class="inv-contracts-count">${String(contracts.length).padStart(2, '0')}</span></h2>
                ${contracts.map(renderContractCard).join('')}
            </section>`;
    }

    function renderContractCard(contract) {
        const studio = contract.studios || {};
        const name = studio.name || 'Estudio';
        const meta = [M.CONTRACT_ROLE_LABELS[contract.role], M.compensationSummary(contract)].filter(Boolean).join(' · ');
        return `
            <article class="inv-contract" tabindex="0" role="link" aria-label="${escapeHtml(`Revisar el contrato ${M.contractLabel(contract)} de ${name}`)}" data-open-contract="${escapeHtml(contract.id)}">
                <span class="inv-contract-number">${escapeHtml(M.contractLabel(contract))}</span>
                <h3 class="inv-contract-name">${escapeHtml(name)}</h3>
                <span class="inv-contract-meta">${escapeHtml(meta)}</span>
                <span class="inv-contract-expiry">${escapeHtml(M.contractExpiryLabel(contract))}</span>
                <span class="inv-badge inv-badge--accent inv-contract-badge">${escapeHtml(M.contractStatusLabel('sent'))}</span>
                <div class="inv-contract-actions">${contractLink(contract, 'inv-btn inv-btn--accent', 'Revisar y firmar')}</div>
            </article>`;
    }

    function renderFeature(membership) {
        const details = detailsOf(membership);
        const studio = studioOf(membership);
        const photo = M.studioPhotos(studio)[0];
        const when = M.shortDate(eventDate(membership)).toUpperCase();
        const contract = pendingContractOf(membership);
        const media = photo
            ? `<div class="inv-feature-media" style="background-image:url('${cssUrl(photo)}')" role="img" aria-label="Foto de ${escapeHtml(studioName(membership))}"></div>`
            : `<div class="inv-feature-media inv-photo--empty" aria-hidden="true">${icon('image')}</div>`;
        return `
            <article class="inv-feature" tabindex="0" role="link" aria-label="Ver invitación de ${escapeHtml(studioName(membership))}" data-open-card="${escapeHtml(membership.id)}">
                <div class="inv-feature-body">
                    <div class="inv-feature-top"><span class="inv-feature-eyebrow">Invitación del mes${when ? ` · ${escapeHtml(when)}` : ''}</span><span class="inv-badge inv-badge--accent">${contract ? 'Contrato para firmar' : 'Pendiente'}</span></div>
                    <h2 class="inv-feature-name">${escapeHtml(studioName(membership))}</h2>
                    <span class="inv-feature-meta">${escapeHtml(styleMeta(membership))}</span>
                    ${details.message ? `<div class="inv-quote-row"><span class="inv-quote-mark" aria-hidden="true"></span><p class="inv-quote">${escapeHtml(details.message)}</p></div>` : ''}
                    ${termsLine(membership) ? `<span class="inv-terms">${escapeHtml(termsLine(membership))}</span>` : ''}
                    <div class="inv-feature-actions">
                        ${contract
                            ? contractLink(contract, 'inv-btn inv-btn--accent')
                            : `<button type="button" class="inv-btn inv-btn--accent" data-action="accept" data-id="${escapeHtml(membership.id)}">${icon('check')} Aceptar</button>`}
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
        const contract = pendingContractOf(membership);
        return `
            <article class="inv-row" tabindex="0" role="link" aria-label="Ver invitación de ${escapeHtml(studioName(membership))}" data-open-card="${escapeHtml(membership.id)}">
                <span class="inv-row-date">${escapeHtml(M.shortDate(eventDate(membership)).toUpperCase() || PLACEHOLDER)}</span>
                <h3 class="inv-row-name${studioName(membership).length > 16 ? ' inv-row-name--long' : ''}">${escapeHtml(studioName(membership))}</h3>
                <span class="inv-row-meta">${escapeHtml(styleMeta(membership))}</span>
                <p class="inv-row-quote">${details.message ? `“${escapeHtml(details.message)}”` : ''}</p>
                <span class="inv-badge inv-badge--pending inv-row-badge">${contract ? 'Contrato para firmar' : 'Pendiente'}</span>
                <div class="inv-row-actions">
                    ${contract
                        ? contractLink(contract, 'inv-btn inv-btn--ink inv-btn--row', 'Revisar y firmar')
                        : `<button type="button" class="inv-btn inv-btn--ink inv-btn--row" data-action="accept" data-id="${escapeHtml(membership.id)}">Aceptar</button>`}
                    <button type="button" class="inv-btn inv-btn--row" data-action="reject" data-id="${escapeHtml(membership.id)}">Rechazar</button>
                </div>
            </article>`;
    }

    // Solicitud de alta enviada por el artista: espera al estudio (o a que el
    // estudio se sume a We Ötzi) y se puede retirar.
    function renderRequest(membership) {
        const contract = pendingContractOf(membership);
        const name = studioName(membership);
        return `
            <article class="inv-row inv-row--request" tabindex="0" role="link" aria-label="Ver tu solicitud a ${escapeHtml(name)}" data-open-card="${escapeHtml(membership.id)}">
                <span class="inv-row-date">${escapeHtml(M.shortDate(eventDate(membership)).toUpperCase() || PLACEHOLDER)}</span>
                <h3 class="inv-row-name${name.length > 16 ? ' inv-row-name--long' : ''}">${escapeHtml(name)}</h3>
                <span class="inv-row-meta">${escapeHtml(styleMeta(membership))}</span>
                <p class="inv-row-quote inv-row-wait">${escapeHtml(M.requestWaitingLabel(membership))}</p>
                <span class="inv-badge inv-badge--request inv-row-badge">${contract ? 'Contrato para firmar' : 'Solicitud enviada'}</span>
                <div class="inv-row-actions">
                    ${contract ? contractLink(contract, 'inv-btn inv-btn--ink inv-btn--row', 'Revisar y firmar') : ''}
                    <button type="button" class="inv-btn inv-btn--row" data-action="withdraw" data-id="${escapeHtml(membership.id)}">Retirar solicitud</button>
                </div>
            </article>`;
    }

    function renderRejected(membership) {
        const name = studioName(membership);
        const meta = [cityOf(membership)].concat(detailsOf(membership).styles, M.shortDate(eventDate(membership)).toUpperCase()).filter(Boolean).join(' · ');
        const label = membership._detail === 'rejected_by_studio' ? M.REJECTED_BY_STUDIO_COPY : 'Rechazada';
        return `
            <article class="inv-rejected" data-id="${escapeHtml(membership.id)}">
                <div class="inv-rejected-id">
                    <span class="inv-rejected-avatar" aria-hidden="true">${escapeHtml(M.initials(name))}</span>
                    <a class="inv-rejected-name" href="${escapeHtml(hrefFor({ invitacion: membership.id }))}" data-inv-nav="invitation" data-invitation="${escapeHtml(membership.id)}">${escapeHtml(name)}</a>
                    <span class="inv-rejected-meta">${escapeHtml(meta)}</span>
                </div>
                <div class="inv-rejected-side"><span class="inv-rejected-status-label">${escapeHtml(label)}</span>${studioLink(membership)}</div>
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

    // Stepper genérico ([{label, done, current}]) con el mismo markup.
    function stepsHtml(steps, ariaLabel) {
        return `<div class="inv-stepper" role="list" aria-label="${escapeHtml(ariaLabel)}">${steps.map((step, index) => {
            const line = index ? `<span class="inv-step-line ${step.done || step.current ? 'is-done' : ''}" aria-hidden="true"></span>` : '';
            return `${line}<span class="inv-step ${step.done ? 'is-done' : ''} ${step.current ? 'is-current' : ''}" role="listitem"${step.current ? ' aria-current="step"' : ''}><span class="inv-step-dot">${step.done ? icon('check') : index + 1}</span><span>${escapeHtml(step.label)}</span></span>`;
        }).join('')}</div>`;
    }

    // "Solicitud enviada → En revisión → Aprobada"
    function requestStepperHtml(detail) {
        return stepsHtml(M.requestSteps(detail), 'Progreso de tu solicitud');
    }

    function contractStepperHtml(status) {
        const closed = ['declined', 'cancelled', 'expired', 'terminated'].includes(status);
        return stepsHtml([
            { label: 'Contrato recibido', done: true, current: false },
            { label: 'Tu revisión', done: status !== 'sent', current: status === 'sent' },
            { label: closed ? M.contractStatusLabel(status) : 'Firmado', done: status === 'signed', current: closed },
        ], 'Progreso del contrato');
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

    function stateLabel(itemState, membership) {
        const detail = membership && membership._detail;
        if (detail === 'requested') return 'Solicitud enviada';
        if (detail === 'rejected_by_studio') return 'No aprobada';
        if (itemState === 'active') return membership && isRequest(membership) ? 'Solicitud aprobada' : 'Invitación aceptada';
        if (itemState === 'rejected') return 'Invitación rechazada';
        return 'Invitación recibida';
    }

    function roleLabel(role) {
        return role === 'guest' ? 'Guest artist' : role === 'manager' ? 'Manager' : role === 'itinerant' ? 'Artista itinerante' : 'Artista residente';
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

    // Lo que el artista mandó al pedir el alta (studio_membership_request_details).
    function requestPanel(membership) {
        const request = M.requestDetails(membership);
        const location = locationOf(membership);
        const cells = [
            ['Rol pedido', roleLabel(membership.role)],
            ['Sede', [location.label, location.city].filter(Boolean).join(' · ') || 'Sin preferencia'],
            ['Fecha propuesta', request.proposedStartDate ? `A partir del ${M.dayMonth(request.proposedStartDate)}` : 'A coordinar con el estudio'],
            ['Estado', membership._detail === 'requested' ? M.requestWaitingLabel(membership) : stateLabel(membership._state, membership)],
        ];
        const portfolio = request.portfolioUrl ? safeUrl(request.portfolioUrl) : null;
        return `
            <div class="inv-offer-grid">${cells.map(([key, value]) => `<div class="inv-offer-cell"><span class="inv-key">${escapeHtml(key)}</span><span class="inv-offer-value">${escapeHtml(value)}</span></div>`).join('')}</div>
            ${request.message || portfolio ? `<section class="inv-message-card">
                <span class="inv-key">Tu mensaje</span>
                ${request.message ? `<blockquote>“${escapeHtml(request.message)}”</blockquote>` : ''}
                ${portfolio ? `<a class="inv-link" href="${escapeHtml(portfolio)}" target="_blank" rel="noopener noreferrer">Ver el portfolio que compartiste →</a>` : ''}
            </section>` : ''}`;
    }

    function infoPanel(membership) {
        const details = detailsOf(membership);
        const location = locationOf(membership);
        const request = isRequest(membership);
        const rows = request
            ? [
                ['Solicitud enviada', M.longDate(membership.invited_at) || PLACEHOLDER],
                ['Estudio en We Ötzi', membership.studio_has_owner === false ? 'Todavía no activó su cuenta' : 'Sí'],
                ['Rol pedido', roleLabel(membership.role)],
                ['Sede', [location.label, location.formatted_address || locationText(membership)].filter(Boolean).join(' · ') || PLACEHOLDER],
            ]
            : [
                ['Invitación enviada', M.longDate(membership.invited_at) || PLACEHOLDER],
                ['Fecha límite', M.longDate(details.responseDueAt) || 'Sin fecha límite'],
                ['Rol propuesto', roleLabel(membership.role)],
                ['Sede', [location.label, location.formatted_address || locationText(membership)].filter(Boolean).join(' · ') || PLACEHOLDER],
            ];
        if (!request && (details.contactName || details.contactEmail)) {
            rows.push(['Contacto', `${escapeHtml(details.contactName || 'Estudio')}${details.contactTitle ? `<small>${escapeHtml(details.contactTitle)}</small>` : ''}${details.contactEmail ? `<small><a href="mailto:${escapeHtml(details.contactEmail)}">${escapeHtml(details.contactEmail)}</a></small>` : ''}`, true]);
        }
        return `<dl class="inv-info-list">${rows.map(([key, value, html]) => `<div><dt class="inv-key">${escapeHtml(key)}</dt><dd>${html ? value : escapeHtml(value)}</dd></div>`).join('')}</dl>`;
    }

    // Contrato vigente de una membresía activa (resumen + enlace al documento).
    function currentContractHtml(contract) {
        if (!contract) return '';
        const cells = [
            ['Contrato', M.contractLabel(contract)],
            ['Modalidad', M.compensationSummary(contract)],
            ['Vigencia', M.contractValidity(contract)],
        ];
        return `
            <section class="inv-contract-current" aria-labelledby="inv-current-contract-title">
                <div class="inv-contract-current-head">
                    <span class="inv-key" id="inv-current-contract-title">Contrato vigente</span>
                    <span class="inv-detail-status inv-detail-status--active">${escapeHtml(M.contractStatusLabel('signed'))}</span>
                </div>
                <div class="inv-offer-grid">${cells.map(([key, value]) => `<div class="inv-offer-cell"><span class="inv-key">${escapeHtml(key)}</span><span class="inv-offer-value">${escapeHtml(value)}</span></div>`).join('')}</div>
                <a class="inv-link" href="${escapeHtml(hrefFor({ contrato: contract.id }))}" data-inv-nav="contract" data-contract="${escapeHtml(contract.id)}">Ver contrato completo →</a>
            </section>`;
    }

    function detailMain(membership) {
        const studio = studioOf(membership);
        const details = detailsOf(membership);
        const request = isRequest(membership);
        const instagram = M.text(studio.instagram).replace(/^@/, '');
        const website = M.text(studio.website);
        const websiteUrl = website ? safeUrl(/^https?:\/\//i.test(website) ? website : 'https://' + website) : null;
        const description = M.text(studio.bio) || M.text(studio.tagline);
        const tab = state.detailTab;
        const contactInitials = M.initials(details.contactName || studioName(membership));
        const firstPanel = request ? requestPanel(membership) : offerPanel(membership);
        return `
            <div class="inv-detail-kicker">
                <span class="inv-detail-status inv-detail-status--${escapeHtml(membership._detail === 'requested' ? 'requested' : membership._state)}">${escapeHtml(stateLabel(membership._state, membership))}</span>
                ${locationText(membership) ? `<span class="inv-detail-place">${icon('map-pin')}${escapeHtml(locationText(membership))}</span>` : ''}
            </div>
            <h1 class="inv-detail-title">${escapeHtml(studioName(membership))}</h1>
            ${galleryHtml(membership)}
            ${description ? `<p class="inv-detail-desc">${escapeHtml(description)}</p>` : ''}
            <div class="inv-detail-links">
                ${instagram ? `<a href="https://instagram.com/${encodeURIComponent(instagram)}" target="_blank" rel="noopener">${icon('instagram')}@${escapeHtml(instagram)}</a>` : ''}
                ${websiteUrl ? `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener">${icon('external-link')}${escapeHtml(website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : ''}
                <span id="inv-roster" hidden>${icon('users')}<span></span></span>
            </div>
            ${details.styles.length ? `<div class="inv-chips">${details.styles.map((style) => `<span class="inv-chip">${escapeHtml(style)}</span>`).join('')}</div>` : ''}
            <div class="inv-detail-tabs" role="tablist" aria-label="${request ? 'Información de tu solicitud' : 'Información de la invitación'}">
                <button type="button" class="inv-detail-tab ${tab === 'roster' ? 'is-active' : ''}" role="tab" id="inv-tab-roster" aria-controls="inv-panel" aria-selected="${tab === 'roster'}" data-detail-tab="roster">${request ? 'Tu solicitud' : 'Roster'}</button>
                <button type="button" class="inv-detail-tab ${tab === 'details' ? 'is-active' : ''}" role="tab" id="inv-tab-details" aria-controls="inv-panel" aria-selected="${tab === 'details'}" data-detail-tab="details">${request ? 'Detalles de la solicitud' : 'Detalles de la invitación'}</button>
            </div>
            <div id="inv-panel" role="tabpanel" aria-labelledby="inv-tab-${tab === 'roster' ? 'roster' : 'details'}">${tab === 'roster' ? firstPanel : infoPanel(membership)}</div>
            ${!request && details.message ? `<section class="inv-message-card">
                <span class="inv-key">Mensaje del estudio</span>
                <blockquote>“${escapeHtml(details.message)}”</blockquote>
                ${details.contactName ? `<div class="inv-message-person"><span class="inv-message-avatar" aria-hidden="true">${escapeHtml(contactInitials)}</span><strong>${escapeHtml(details.contactName)}</strong>${details.contactTitle ? `<span>— ${escapeHtml(details.contactTitle)}</span>` : ''}</div>` : ''}
            </section>` : ''}
            ${currentContractHtml(currentContractOf(membership))}
            ${membership._state === 'active' ? '<section class="inv-materials" id="inv-materials" aria-labelledby="inv-materials-title" hidden></section>' : ''}`;
    }

    function asideSub(membership) {
        switch (membership._detail) {
            case 'pending': return pendingContractOf(membership)
                ? 'El estudio te mandó el contrato. Revisalo y firmalo para sumarte al roster.'
                : 'El estudio te seleccionó. Revisá las condiciones y respondé.';
            case 'requested': return pendingContractOf(membership)
                ? 'El estudio aprobó tu pedido con un contrato. Revisalo y firmalo para sumarte.'
                : `Le pediste el alta a este estudio. ${M.requestWaitingLabel(membership)}.`;
            case 'active': return 'Ya formás parte del roster de este estudio.';
            case 'rejected_by_studio': return `${M.REJECTED_BY_STUDIO_COPY}. Podés volver a pedir el alta más adelante.`;
            default: return 'Rechazaste esta invitación. El estudio puede volver a invitarte.';
        }
    }

    function detailAside(membership) {
        const details = detailsOf(membership);
        const studio = studioOf(membership);
        const contract = pendingContractOf(membership);
        const current = currentContractOf(membership);
        const id = escapeHtml(membership.id);
        const contactButton = `<button type="button" class="inv-aside-btn inv-aside-btn--outline" data-action="contact" data-id="${id}">${icon('message-circle')} Contactar al estudio</button>`;
        const studioButton = studio.id ? `<a class="inv-aside-btn" href="${escapeHtml(hrefFor({ estudio: studio.id }))}" data-inv-nav="studio" data-studio="${escapeHtml(studio.id)}">Ver estudio ${icon('arrow-right')}</a>` : '';
        const signButton = contract ? contractLink(contract, 'inv-aside-btn inv-aside-btn--primary') : '';
        let actions = '';
        if (membership._state === 'pending') {
            actions = `
                ${signButton || `<button type="button" class="inv-aside-btn inv-aside-btn--primary" data-action="accept" data-id="${id}">${icon('check')} Aceptar invitación</button>`}
                ${contactButton}
                <button type="button" class="inv-aside-btn" data-action="request-changes" data-id="${id}">${icon('edit')} Solicitar cambios</button>
                <button type="button" class="inv-aside-btn" data-action="reject" data-id="${id}">${icon('x')} Rechazar invitación</button>`;
        } else if (membership._state === 'requested') {
            actions = `
                ${signButton}
                ${contactButton}
                ${studioButton}
                <button type="button" class="inv-aside-btn" data-action="withdraw" data-id="${id}">${icon('x')} Retirar solicitud</button>`;
        } else {
            actions = `
                ${contactButton}
                ${studioButton}
                ${membership._state === 'active' && current ? `<button type="button" class="inv-aside-btn" data-action="terminate" data-id="${id}" data-contract="${escapeHtml(current.id)}">${icon('file-minus')} Rescindir contrato</button>` : ''}
                ${membership._state === 'active' && !current ? `<button type="button" class="inv-aside-btn" data-action="leave" data-id="${id}">${icon('log-out')} Salir del roster</button>` : ''}`;
        }
        const rows = membership._state === 'requested'
            ? [
                ['Estado', `<span class="inv-detail-status inv-detail-status--requested">${escapeHtml(stateLabel(membership._state, membership))}</span>`],
                ['Enviada', `<span class="inv-aside-value">${escapeHtml(M.longDate(membership.invited_at) || PLACEHOLDER)}</span>`],
                ['Respuesta', `<span class="inv-aside-value">${escapeHtml(M.requestWaitingLabel(membership))}</span>`],
            ]
            : [
                ['Estado', `<span class="inv-detail-status inv-detail-status--${escapeHtml(membership._state)}">${escapeHtml(stateLabel(membership._state, membership))}</span>`],
                ['Fecha límite', `<span class="inv-aside-value">${escapeHtml(M.longDate(details.responseDueAt) || 'Sin fecha límite')}</span>`],
                ['Contacto', `<span class="inv-aside-value">${escapeHtml(details.contactName || studioName(membership))}</span>`],
            ];
        if (contract) rows.push(['Contrato', `<span class="inv-aside-value">${escapeHtml(`${M.contractLabel(contract)} · ${M.contractExpiryLabel(contract)}`)}</span>`]);
        return `
            <h2 class="inv-aside-title">${membership._state === 'requested' || (isRequest(membership) && membership._state !== 'pending') ? 'Resumen de tu solicitud' : 'Resumen de la invitación'}</h2>
            <p class="inv-aside-sub">${escapeHtml(asideSub(membership))}</p>
            <div class="inv-aside-rows">${rows.map(([key, value]) => `<div class="inv-aside-row"><span class="inv-key">${escapeHtml(key)}</span>${value}</div>`).join('')}</div>
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
                ${isRequest(membership) ? requestStepperHtml(membership._detail) : stepperHtml(membership._state)}
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
                else if (action === 'withdraw') withdrawRequest(id, button);
                else if (action === 'terminate') {
                    const contract = findContract(button.dataset.contract);
                    if (contract) showTerminateDrawer(contract, button);
                } else decide(action, id, button);
            });
        });
        loadRosterCount(membership);
        if (membership._state === 'active') loadMaterials(membership);
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

    /* ------------------------ materiales entregados ------------------------ */
    // list_my_studio_material_assignments trae las entregas y devoluciones de
    // todos los estudios del artista; se filtra por el de la membresía.
    async function loadMaterials(membership) {
        const ops = D.StudioOps;
        if (!ops || typeof ops.listMyMaterialAssignments !== 'function' || state.materialsUnavailable) return;
        if (!state.materials) {
            const result = await safeCall(() => ops.listMyMaterialAssignments());
            if (result.error || result.unavailable) {
                if (result.error && !M.isMissingSchema(result.error)) console.warn('[invitaciones] materiales:', result.error);
                state.materialsUnavailable = true;
                return;
            }
            state.materials = Array.isArray(result.data) ? result.data : [];
        }
        const host = document.getElementById('inv-materials');
        if (!host || state.current?.id !== membership.id) return;
        const summary = M.materialsForStudio(state.materials, studioOf(membership).id || membership.studio_id);
        host.innerHTML = materialsHtml(summary);
        host.hidden = false;
    }

    function materialsHtml(summary) {
        const head = '<span class="inv-key" id="inv-materials-title">Materiales entregados</span>';
        if (!summary.movements.length) {
            return `${head}<p class="inv-materials-empty">El estudio todavía no registró entregas de materiales para vos.</p>`;
        }
        return `${head}
            <ul class="inv-materials-summary">${summary.items.map((item) => `
                <li><strong>${escapeHtml(item.itemName)}</strong><span>${escapeHtml(`Neto: ${item.netLabel || '0'}`)}</span><small>${escapeHtml(`${M.formatQuantity(item.delivered, item.unit) || '0'} entregado · ${M.formatQuantity(item.returned, item.unit) || '0'} devuelto`)}</small></li>`).join('')}
            </ul>
            <div class="inv-materials-scroll">
                <table class="inv-materials-table">
                    <thead><tr><th scope="col">Fecha</th><th scope="col">Movimiento</th><th scope="col">Material</th><th scope="col">Cantidad</th></tr></thead>
                    <tbody>${summary.movements.map((row) => `<tr><td>${escapeHtml(row.date || PLACEHOLDER)}</td><td>${escapeHtml(row.kindLabel)}</td><td>${escapeHtml(row.itemName)}</td><td>${escapeHtml(row.quantity || PLACEHOLDER)}</td></tr>`).join('')}</tbody>
                </table>
            </div>`;
    }

    /* ------------------------------ contrato ------------------------------ */
    function signatureRows(contract, status) {
        const rows = [];
        const studioSigned = [M.text(contract.studio_signer_name), M.longDate(contract.studio_signed_at)].filter(Boolean).join(' · ');
        rows.push(['Firma del estudio', studioSigned || PLACEHOLDER]);
        const artistSigned = [M.text(contract.artist_signer_name), M.longDate(contract.artist_signed_at)].filter(Boolean).join(' · ');
        rows.push(['Tu firma', artistSigned || (status === 'sent' ? 'Pendiente de tu firma' : PLACEHOLDER)]);
        if (contract.declined_at) rows.push(['Rechazado', [M.longDate(contract.declined_at), M.text(contract.decline_reason)].filter(Boolean).join(' · ')]);
        if (contract.cancelled_at) rows.push(['Cancelado por el estudio', [M.longDate(contract.cancelled_at), M.text(contract.cancel_reason)].filter(Boolean).join(' · ')]);
        if (contract.terminated_at) rows.push(['Rescindido', [M.longDate(contract.terminated_at), M.text(contract.termination_reason)].filter(Boolean).join(' · ')]);
        return rows;
    }

    function contractMain(contract, status) {
        const studio = contract.studios || {};
        const lists = M.contractLists(contract);
        const intro = status === 'sent'
            ? `${studio.name || 'El estudio'} te envió este contrato. Leelo completo: al firmarlo quedás en su roster con estas condiciones.`
            : 'Contrato registrado en We Ötzi. Los términos quedaron congelados al emitirse.';
        return `
            <div class="inv-detail-kicker">
                <span class="inv-detail-status inv-detail-status--${escapeHtml(M.contractStatusTone(status))}">${escapeHtml(M.contractStatusLabel(status))}</span>
                <span class="inv-detail-place">${icon('file-text')}${escapeHtml(`Contrato ${M.contractLabel(contract)}`)}</span>
            </div>
            <h1 class="inv-detail-title">${escapeHtml(studio.name || 'Estudio')}</h1>
            <p class="inv-detail-desc">${escapeHtml(intro)}</p>
            <div class="inv-offer-grid">${M.contractCells(contract).map(([key, value]) => `<div class="inv-offer-cell"><span class="inv-key">${escapeHtml(key)}</span><span class="inv-offer-value">${escapeHtml(value)}</span></div>`).join('')}</div>
            ${lists.length ? `<div class="inv-detail-bullets">${lists.map(([title, values]) => `<section><span class="inv-key">${escapeHtml(title)}</span><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>`).join('')}</div>` : ''}
            ${M.text(contract.house_rules) ? `<section class="inv-contract-section"><span class="inv-key">Normas del estudio</span><p class="inv-contract-text">${escapeHtml(contract.house_rules)}</p></section>` : ''}
            ${M.text(contract.terms) ? `<section class="inv-contract-section"><span class="inv-key">Cláusulas</span><p class="inv-contract-text">${escapeHtml(contract.terms)}</p></section>` : ''}
            <section class="inv-contract-section">
                <span class="inv-key">Firmas</span>
                <dl class="inv-info-list">${signatureRows(contract, status).map(([key, value]) => `<div><dt class="inv-key">${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
            </section>
            ${M.text(contract.terms_hash) ? `<p class="inv-contract-hash"><span class="inv-key">Huella del contrato (SHA-256)</span><code>${escapeHtml(contract.terms_hash)}</code></p>` : ''}`;
    }

    function contractAside(contract, status, membership) {
        const id = escapeHtml(contract.id);
        const sub = {
            sent: 'Firmalo para sumarte al roster o rechazalo si no estás de acuerdo.',
            signed: 'Contrato vigente. Si necesitás terminarlo, podés rescindirlo.',
            declined: 'Rechazaste este contrato.',
            cancelled: 'El estudio canceló este contrato antes de la firma.',
            terminated: 'Este contrato ya no está vigente.',
            expired: 'Este contrato venció sin firmarse. Pedile al estudio uno nuevo.',
        }[status] || '';
        const rows = [
            ['Estado', `<span class="inv-detail-status inv-detail-status--${escapeHtml(M.contractStatusTone(status))}">${escapeHtml(M.contractStatusLabel(status))}</span>`],
            ['Versión', `<span class="inv-aside-value">${escapeHtml(M.contractLabel(contract))}</span>`],
            ['Enviado', `<span class="inv-aside-value">${escapeHtml(M.longDate(contract.sent_at) || PLACEHOLDER)}</span>`],
        ];
        if (status === 'sent') rows.push(['Vencimiento', `<span class="inv-aside-value">${escapeHtml(M.contractExpiryLabel(contract))}</span>`]);
        if (contract.artist_signed_at) rows.push(['Firmado', `<span class="inv-aside-value">${escapeHtml(M.longDate(contract.artist_signed_at))}</span>`]);
        const actions = [];
        if (status === 'sent') {
            actions.push(`<button type="button" class="inv-aside-btn inv-aside-btn--primary" data-contract-action="sign" data-id="${id}">${icon('check')} Firmar y aceptar</button>`);
            actions.push(`<button type="button" class="inv-aside-btn" data-contract-action="decline" data-id="${id}">${icon('x')} Rechazar contrato</button>`);
        }
        if (status === 'signed') {
            actions.push(`<button type="button" class="inv-aside-btn" data-contract-action="terminate" data-id="${id}">${icon('file-minus')} Rescindir contrato</button>`);
        }
        actions.push(`<button type="button" class="inv-aside-btn inv-aside-btn--outline" data-contract-action="contact" data-id="${id}">${icon('message-circle')} Contactar al estudio</button>`);
        if (membership) actions.push(`<a class="inv-aside-btn" href="${escapeHtml(hrefFor({ invitacion: membership.id }))}" data-inv-nav="invitation" data-invitation="${escapeHtml(membership.id)}">${escapeHtml(isRequest(membership) ? 'Ver tu solicitud' : 'Ver invitación')} ${icon('arrow-right')}</a>`);
        actions.push(`<button type="button" class="inv-aside-btn" data-contract-action="print" data-id="${id}">${icon('printer')} Imprimir</button>`);
        return `
            <h2 class="inv-aside-title">Resumen del contrato</h2>
            ${sub ? `<p class="inv-aside-sub">${escapeHtml(sub)}</p>` : ''}
            <div class="inv-aside-rows">${rows.map(([key, value]) => `<div class="inv-aside-row"><span class="inv-key">${escapeHtml(key)}</span>${value}</div>`).join('')}</div>
            <div class="inv-aside-actions">${actions.join('')}</div>`;
    }

    function renderContract(contract) {
        const view = document.getElementById('inv-detail-view');
        if (!view || !contract) return;
        state.currentContract = contract;
        const status = M.contractState(contract);
        const membership = contract.membership_id ? findItem(contract.membership_id) : null;
        view.innerHTML = `
            <div class="inv-detail-header">
                <a class="inv-detail-back" href="${escapeHtml(hrefFor({}))}" data-inv-nav="feed">${icon('arrow-left')} Volver a invitaciones</a>
                ${contractStepperHtml(status)}
            </div>
            <div class="inv-detail-main inv-contract-doc">${contractMain(contract, status)}</div>
            <aside class="inv-detail-aside" aria-label="Resumen del contrato">${contractAside(contract, status, membership)}</aside>`;
        view.querySelectorAll('[data-contract-action]').forEach((button) => {
            button.addEventListener('click', () => {
                const action = button.dataset.contractAction;
                if (action === 'sign') showSignDrawer(contract, button);
                else if (action === 'decline') showDeclineDrawer(contract, button);
                else if (action === 'terminate') showTerminateDrawer(contract, button);
                else if (action === 'print') window.print();
                else if (action === 'contact') {
                    const studio = contract.studios || {};
                    if (!window.WoInvitationsStudio || !(studio.id || contract.studio_id)) return;
                    window.WoInvitationsStudio.openContact({
                        studioId: studio.id || contract.studio_id,
                        studioName: studio.name || 'el estudio',
                        reason: contract.role === 'guest' || contract.role === 'itinerant' ? 'guest_spot' : 'resident',
                        trigger: button,
                    });
                }
            });
        });
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
        const updated = findItem(membershipId) || { ...membership, _state: action === 'accept' ? 'active' : 'rejected', _detail: action === 'accept' ? 'active' : 'rejected_by_artist' };
        navigate({}, { replace: !!params().get('invitacion') });
        if (action === 'accept') showAcceptedDrawer(updated, trigger);
        else showRejectedDrawer(updated, trigger);
    }

    async function leave(membershipId, trigger) {
        if (!window.confirm('¿Salir del roster de este estudio? Tu perfil personal queda intacto.')) return;
        const contract = currentContractOf(findItem(membershipId));
        setBusy(trigger, true);
        let result;
        try { result = await D.StudioMemberships.endMembership(membershipId); } catch (error) { result = { error }; }
        setBusy(trigger, false);
        if (result && result.error) { showInlineError(trigger, result.error.message); return; }
        // end_studio_membership rescinde el contrato vigente: se le avisa al estudio.
        if (contract) notifyStudio('contract_terminated', { contract_id: contract.id });
        await load();
        navigate({}, { replace: true });
    }

    // requested -> ended (withdraw_studio_membership_request). Cancela los
    // contratos en borrador o enviados de esa solicitud.
    async function withdrawRequest(membershipId, trigger) {
        const membership = findItem(membershipId);
        if (!membership || !D.StudioMemberships || typeof D.StudioMemberships.withdrawRequest !== 'function') return;
        if (!window.confirm(`¿Retirar tu solicitud a ${studioName(membership)}? Podés volver a pedir el alta más adelante.`)) return;
        setBusy(trigger, true);
        let result;
        try { result = await D.StudioMemberships.withdrawRequest(membershipId); } catch (error) { result = { error }; }
        setBusy(trigger, false);
        if (result && result.error) {
            showInlineError(trigger, M.friendlyError(result.error, 'No pudimos retirar tu solicitud.'));
            return;
        }
        document.dispatchEvent(new CustomEvent('weotzi:studio-request-withdrawn', {
            detail: { membershipId, studioId: studioOf(membership).id || null },
        }));
        await load();
        navigate({}, { replace: !!params().get('invitacion') });
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

    function contractStudioName(contract) { return (contract.studios && contract.studios.name) || 'el estudio'; }

    function setDrawerError(form, key, message) {
        const node = form.querySelector(`[data-error="${key}"]`);
        if (!node) return;
        node.textContent = message || '';
        node.hidden = !message;
    }

    // Firma en plataforma: nombre completo + "Leí y acepto los términos".
    function showSignDrawer(contract, trigger) {
        openDrawer(`
            <aside class="inv-drawer inv-drawer--sign" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title" tabindex="-1">
                <button type="button" class="inv-drawer-close" data-drawer-close aria-label="Cerrar">${icon('x')}</button>
                <h2 class="inv-drawer-heading" id="inv-drawer-title">Firmar contrato</h2>
                <p class="inv-change-copy">${escapeHtml(`${M.contractLabel(contract)} con ${contractStudioName(contract)}. Tu nombre completo funciona como firma.`)}</p>
                <form class="inv-change-form" id="inv-sign-form" novalidate>
                    <label class="inv-key" for="inv-sign-name">Nombre completo</label>
                    <input class="inv-input" id="inv-sign-name" name="name" type="text" autocomplete="name" required minlength="${M.SIGNER_NAME_MIN}" maxlength="160">
                    <p class="inv-drawer-error" data-error="name" role="alert" hidden></p>
                    <label class="inv-check"><input type="checkbox" name="accept"><span>Leí y acepto los términos</span></label>
                    <p class="inv-drawer-error" data-error="accept" role="alert" hidden></p>
                    <p class="inv-drawer-error" data-error="submit" role="alert" hidden></p>
                    <div class="inv-change-actions">
                        <button class="inv-change-submit" type="submit">Firmar y aceptar ${icon('check')}</button>
                        <button class="inv-aside-btn" type="button" data-drawer-close>Volver</button>
                    </div>
                </form>
            </aside>`, trigger);
        const form = document.getElementById('inv-sign-form');
        form?.elements.name.focus();
        form?.addEventListener('submit', async (event) => {
            event.preventDefault();
            ['name', 'accept', 'submit'].forEach((key) => setDrawerError(form, key, ''));
            const check = M.validateSignature({ name: form.elements.name.value, accept: form.elements.accept.checked });
            form.elements.name.setAttribute('aria-invalid', String(!!check.errors.name));
            if (!check.ok) {
                setDrawerError(form, 'name', check.errors.name);
                setDrawerError(form, 'accept', check.errors.accept);
                (check.errors.name ? form.elements.name : form.elements.accept).focus();
                return;
            }
            if (!D.StudioContracts) { setDrawerError(form, 'submit', M.MISSING_SCHEMA_MESSAGE); return; }
            const submit = form.querySelector('[type="submit"]');
            setBusy(submit, true);
            const result = await safeCall(() => D.StudioContracts.sign(contract.id, check.name, true));
            setBusy(submit, false);
            if (result.error) { setDrawerError(form, 'submit', M.friendlyError(result.error, 'No pudimos registrar tu firma.')); return; }
            notifyStudio('contract_signed', { contract_id: contract.id });
            document.dispatchEvent(new CustomEvent('weotzi:studio-contract-signed', {
                detail: { contractId: contract.id, studioId: contract.studio_id || null },
            }));
            await load();
            navigate({ contrato: contract.id }, { replace: true });
            showContractDoneDrawer('signed', contract);
        });
    }

    function showDeclineDrawer(contract, trigger) {
        openDrawer(`
            <aside class="inv-drawer inv-drawer--change" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title" tabindex="-1">
                <h2 class="inv-drawer-heading" id="inv-drawer-title">Rechazar contrato</h2>
                <p class="inv-change-copy">${escapeHtml(`Le avisamos a ${contractStudioName(contract)}. Si querés otras condiciones, contale qué cambiarías.`)}</p>
                <form class="inv-change-form" id="inv-decline-form" novalidate>
                    <label class="inv-key" for="inv-decline-reason">Motivo · opcional</label>
                    <textarea class="inv-change-textarea" id="inv-decline-reason" name="reason" maxlength="1000" placeholder="Ej: necesito empezar un mes más tarde."></textarea>
                    <p class="inv-drawer-error" data-error="submit" role="alert" hidden></p>
                    <div class="inv-change-actions">
                        <button class="inv-change-submit" type="submit">Rechazar contrato ${icon('x')}</button>
                        <button class="inv-aside-btn" type="button" data-drawer-close>Volver</button>
                    </div>
                </form>
            </aside>`, trigger);
        const form = document.getElementById('inv-decline-form');
        form?.elements.reason.focus();
        form?.addEventListener('submit', async (event) => {
            event.preventDefault();
            setDrawerError(form, 'submit', '');
            if (!D.StudioContracts) { setDrawerError(form, 'submit', M.MISSING_SCHEMA_MESSAGE); return; }
            const submit = form.querySelector('[type="submit"]');
            setBusy(submit, true);
            const result = await safeCall(() => D.StudioContracts.decline(contract.id, form.elements.reason.value.trim() || null));
            setBusy(submit, false);
            if (result.error) { setDrawerError(form, 'submit', M.friendlyError(result.error, 'No pudimos rechazar el contrato.')); return; }
            notifyStudio('contract_declined', { contract_id: contract.id });
            await load();
            navigate({ contrato: contract.id }, { replace: true });
            showContractDoneDrawer('declined', contract);
        });
    }

    function showTerminateDrawer(contract, trigger) {
        openDrawer(`
            <aside class="inv-drawer inv-drawer--change" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title" tabindex="-1">
                <h2 class="inv-drawer-heading" id="inv-drawer-title">Rescindir contrato</h2>
                <p class="inv-change-copy">${escapeHtml(`El contrato ${M.contractLabel(contract)} deja de estar vigente y salís del roster de ${contractStudioName(contract)}. ${M.contractNotice(contract)}.`)}</p>
                <form class="inv-change-form" id="inv-terminate-form" novalidate>
                    <label class="inv-key" for="inv-terminate-reason">Motivo</label>
                    <textarea class="inv-change-textarea" id="inv-terminate-reason" name="reason" required maxlength="1000" placeholder="Contale al estudio por qué rescindís."></textarea>
                    <p class="inv-drawer-error" data-error="submit" role="alert" hidden></p>
                    <div class="inv-change-actions">
                        <button class="inv-change-submit" type="submit">Rescindir contrato</button>
                        <button class="inv-aside-btn" type="button" data-drawer-close>Volver</button>
                    </div>
                </form>
            </aside>`, trigger);
        const form = document.getElementById('inv-terminate-form');
        form?.elements.reason.focus();
        form?.addEventListener('submit', async (event) => {
            event.preventDefault();
            setDrawerError(form, 'submit', '');
            const reason = form.elements.reason.value.trim();
            if (!reason) { setDrawerError(form, 'submit', 'Escribí el motivo de la rescisión.'); form.elements.reason.focus(); return; }
            if (!D.StudioContracts) { setDrawerError(form, 'submit', M.MISSING_SCHEMA_MESSAGE); return; }
            const submit = form.querySelector('[type="submit"]');
            setBusy(submit, true);
            const result = await safeCall(() => D.StudioContracts.terminate(contract.id, reason, true));
            setBusy(submit, false);
            if (result.error) { setDrawerError(form, 'submit', M.friendlyError(result.error, 'No pudimos rescindir el contrato.')); return; }
            notifyStudio('contract_terminated', { contract_id: contract.id });
            await load();
            navigate({ contrato: contract.id }, { replace: true });
            showContractDoneDrawer('terminated', contract);
        });
    }

    function showContractDoneDrawer(kind, contract) {
        const name = contractStudioName(contract);
        const copy = {
            signed: ['Contrato firmado', `Ya formás parte del roster de ${name}. Le avisamos al estudio.`],
            declined: ['Contrato rechazado', `Le avisamos a ${name} que no firmaste esta versión.`],
            terminated: ['Contrato rescindido', `Le avisamos a ${name}. Tu perfil personal queda intacto.`],
        }[kind];
        const ok = kind === 'signed';
        openDrawer(`
            <aside class="inv-drawer ${ok ? 'inv-drawer--accepted' : 'inv-drawer--rejected'}" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title" tabindex="-1">
                <button type="button" class="inv-drawer-close" data-drawer-close aria-label="Cerrar">${icon('x')}</button>
                <div class="${ok ? 'inv-drawer-status' : 'inv-rejected-status'}" role="status">${icon(ok ? 'check-circle' : 'alert-circle')}<div><strong id="inv-drawer-title">${escapeHtml(copy[0])}</strong><p>${escapeHtml(copy[1])}</p></div></div>
                <button class="inv-other-invitations" type="button" data-other-invitations>Ver otras invitaciones ${icon('arrow-right')}</button>
            </aside>`, null);
        document.querySelector('#inv-drawer-layer [data-other-invitations]')?.addEventListener('click', () => {
            closeDrawer({ restoreFocus: false });
            navigate({});
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
        return layer;
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
        if (query.get('drawer') || query.get('solicitar')) {
            const url = new URL(window.location.href);
            url.searchParams.delete('drawer');
            url.searchParams.delete('solicitar');
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
        const host = trigger?.closest('.inv-detail-aside, .inv-feature, .inv-row, .inv-contract') || document.getElementById('invitations-list');
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
        safeUrl,
        navigate,
        hrefFor,
        refreshContacts,
        reload: load,
        notifyStudio,
        openDrawer,
        closeDrawer,
        setBusy,
        membershipForStudio,
        openMembershipForStudio,
        contactForStudio,
        pendingContractOf,
        getItems: () => state.items.slice(),
        getContacts: () => state.contacts.slice(),
        getContracts: () => state.contracts.slice(),
        get userId() { return state.userId; },
    };
})();
