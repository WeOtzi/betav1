// ============================================
// We Ötzi — Equipo del estudio (beta cerrada · frente roster)
// Figma de estudios 91wYIpURj0xn0kzqhybOOt, sección 07:
//   E-TEAM-01 (2012:315) lista con filtros Buscar · Rol · Sede · Estado
//   E-TEAM-02 (2012:316) invitar con condiciones
//   E-TEAM-03 (2012:317) "Vínculo con …" (rol, sede, reparto, notas)
//   E-TEAM-04 (2012:318) "Finalizar colaboración"
// Más: solicitudes de alta (ROSTER-02), enlace de invitación (ROSTER-03) e
// invitación por email a quien no tiene cuenta (ROSTER-06).
//
// Datos: WeotziData.StudioMemberships / StudioLocations / Artists (capa
// unificada). Endpoints del servidor: /api/studio/invite-links,
// /api/studio/invite-email y /api/studio/roster-notify (lib/routes/roster.js).
// studio-dashboard.js llama a WeOtziStudioTeam.init(ctx) desde loadRoster().
// Todo texto de datos de usuario pasa por esc().
// ============================================

(function () {
    'use strict';

    const ROLE_LABELS = { resident: 'Residente', guest: 'Guest', itinerant: 'Itinerante', manager: 'Manager' };
    const STATUS_LABELS = {
        active: 'Activo',
        pending_acceptance: 'Invitación pendiente',
        pending_invite: 'Invitación pendiente',
        requested: 'Solicitud pendiente',
        paused: 'Pausado'
    };
    const STATUS_FILTERS = [
        ['', 'Todos los estados'], ['active', 'Activo'], ['pending', 'Invitación pendiente'], ['paused', 'Pausado']
    ];
    const APPROVE_ROLES = ['resident', 'guest', 'itinerant'];

    const state = {
        ctx: null,
        locations: [],
        members: [],
        requests: [],
        links: [],
        filters: { q: '', role: '', location: '', status: '' },
        inviteChosen: null,
        inviteHits: [],
        wired: false,
        returnFocus: null
    };

    // ------------------------------------------------------------- utilidades
    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function $(id) { return document.getElementById(id); }
    function data() { return window.WeotziData || {}; }
    function memberships() { return data().StudioMemberships || {}; }
    function studio() { return state.ctx && state.ctx.studio; }
    function status(kind, msg) { if (state.ctx && state.ctx.showStatus) state.ctx.showStatus('roster-status', kind, msg); }
    function normalize(v) {
        return String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
    function roleLabel(role) { return ROLE_LABELS[role] || 'Artista'; }
    function locationName(id) {
        const loc = state.locations.find(l => l.id === id);
        return loc ? (loc.label || 'Sede') : 'Sin sede asignada';
    }
    function fmtDate(value) {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    function artistName(a) {
        const artist = a || {};
        return artist.name || (artist.username ? '@' + artist.username : 'Artista');
    }
    function initials(name) {
        const out = String(name || '').replace(/^@/, '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
            .map(p => p.charAt(0).toUpperCase()).join('');
        return out || '?';
    }
    function safeUrl(value) {
        const raw = String(value || '').trim();
        return /^https?:\/\//i.test(raw) ? raw : '';
    }
    function lines(value) {
        return String(value || '').split(/\n|;/).map(s => s.trim()).filter(Boolean).slice(0, 12);
    }
    function friendlyError(error, fallback) {
        const raw = String((error && (error.message || error.error)) || '');
        const code = error && error.code;
        if (code === '23505' || /duplicate key|one_open_per_role/i.test(raw)) {
            return 'Ese artista ya tiene un vínculo abierto con ese rol en tu estudio.';
        }
        if (code === '42501' || /permission|row-level security|42501/i.test(raw)) {
            return 'No tienes permiso para hacer esto. Solo el dueño del estudio puede.';
        }
        if (/contrato/i.test(raw)) return raw;
        if (/[áéíóúñ]/.test(raw) && raw.length < 200) return raw;
        return fallback || 'No pudimos completar la acción. Prueba de nuevo.';
    }
    function statusBadge(st) {
        const cls = st === 'active' ? 'wo-badge--success' : (st === 'paused' ? 'wo-badge--outline' : 'wo-badge--accent');
        return `<span class="wo-badge wo-badge--s ${cls}">${esc(STATUS_LABELS[st] || st)}</span>`;
    }
    function locationOptions(selected, { emptyLabel = 'Sin sede asignada' } = {}) {
        return `<option value="">${esc(emptyLabel)}</option>` + state.locations.map(l =>
            `<option value="${esc(l.id)}"${l.id === selected ? ' selected' : ''}>${esc(l.label || 'Sede')}${l.is_primary ? ' (principal)' : ''}</option>`
        ).join('');
    }
    function roleOptions(selected, roles) {
        return (roles || ['resident', 'itinerant', 'guest', 'manager']).map(r =>
            `<option value="${r}"${r === selected ? ' selected' : ''}>${esc(roleLabel(r))}</option>`).join('');
    }
    function setBusy(button, busy, label) {
        if (!button) return;
        button.disabled = !!busy;
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
        if (label != null) button.textContent = label;
    }

    async function api(path, { method = 'GET', body } = {}) {
        const token = state.ctx && state.ctx.getAccessToken ? await state.ctx.getAccessToken() : null;
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        const url = state.ctx && state.ctx.appUrl ? state.ctx.appUrl(path) : path;
        const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json.success === false) {
            const error = new Error(json.error || 'No pudimos completar la acción.');
            error.status = response.status;
            throw error;
        }
        return json;
    }

    // ---------------------------------------------------------------- arranque
    async function init(ctx) {
        state.ctx = ctx;
        if (document.body.dataset.studioAccess === 'manager') return;
        const res = await data().StudioLocations.listActiveByStudio(studio().id, 'id, label, is_primary, city');
        state.locations = (res && res.data) || [];
        renderFilterOptions();
        wire();
        await Promise.all([loadRequests(), loadMembers(), loadLinks()]);
    }

    function renderFilterOptions() {
        const loc = $('team-filter-location');
        if (loc) loc.innerHTML = '<option value="">Todas las sedes</option>' + state.locations.map(l =>
            `<option value="${esc(l.id)}">${esc(l.label || 'Sede')}</option>`).join('');
        const st = $('team-filter-status');
        if (st) st.innerHTML = STATUS_FILTERS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
        ['invite-location', 'link-location'].forEach(id => {
            const el = $(id);
            if (el) el.innerHTML = locationOptions(state.locations.find(l => l.is_primary)?.id || '', { emptyLabel: 'Cualquier sede' });
        });
    }

    function wire() {
        if (state.wired) return;
        state.wired = true;
        const onFilter = () => {
            state.filters.q = normalize($('team-filter-q')?.value);
            state.filters.role = $('team-filter-role')?.value || '';
            state.filters.location = $('team-filter-location')?.value || '';
            state.filters.status = $('team-filter-status')?.value || '';
            renderMembers();
        };
        ['team-filter-q', 'team-filter-role', 'team-filter-location', 'team-filter-status'].forEach(id => {
            $(id)?.addEventListener(id === 'team-filter-q' ? 'input' : 'change', onFilter);
        });
        $('team-open-invite')?.addEventListener('click', () => toggleInvite(true));
        $('invite-cancel')?.addEventListener('click', () => toggleInvite(false));
        $('team-open-link')?.addEventListener('click', () => {
            const box = $('team-links');
            if (box) { box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('link-role')?.focus(); }
        });
        wireInviteSearch();
        $('team-invite')?.addEventListener('submit', onInviteSubmit);
        $('team-email-invite')?.addEventListener('submit', onEmailInviteSubmit);
        $('team-link-form')?.addEventListener('submit', onLinkSubmit);
    }

    function toggleInvite(open) {
        const form = $('team-invite');
        if (!form) return;
        form.hidden = !open;
        const email = $('team-email-invite');
        if (email) email.hidden = !open;
        $('team-open-invite')?.setAttribute('aria-expanded', String(open));
        if (open) $('invite-search')?.focus();
    }

    // ------------------------------------------------- solicitudes de alta
    async function loadRequests() {
        const host = $('team-requests');
        if (!host || typeof memberships().listRequestsForStudio !== 'function') return;
        const { data: rows, error } = await memberships().listRequestsForStudio(studio().id);
        if (error) {
            host.hidden = false;
            $('team-requests-list').innerHTML = `<p class="wo-error-msg" role="alert">${esc(friendlyError(error, 'No pudimos cargar las solicitudes.'))}</p>`;
            return;
        }
        state.requests = rows || [];
        renderRequests();
    }

    function renderRequests() {
        const host = $('team-requests');
        const list = $('team-requests-list');
        const count = $('team-requests-count');
        const badge = document.querySelector('.studio-dash-tab[data-tab="roster"] .steam-tab-count');
        const n = state.requests.length;
        if (count) count.textContent = String(n);
        updateTabBadge(n, badge);
        if (!host || !list) return;
        host.hidden = n === 0;
        if (!n) { list.innerHTML = ''; return; }
        list.innerHTML = state.requests.map(row => {
            const a = row.artists_db || {};
            const d = (Array.isArray(row.request) ? row.request[0] : row.request) || {};
            const styles = (Array.isArray(d.styles) && d.styles.length ? d.styles : (a.styles_array || [])).slice(0, 5);
            const portfolio = safeUrl(d.portfolio_url);
            const profile = a.username && state.ctx.appUrl ? state.ctx.appUrl('/artist/profile?artist=' + encodeURIComponent(a.username)) : '';
            const name = artistName(a);
            const role = APPROVE_ROLES.includes(row.role) ? row.role : 'resident';
            return `<article class="steam-request" data-request-id="${esc(row.id)}" aria-label="Solicitud de ${esc(name)}">
                <header class="steam-request__head">
                    ${avatar(a)}
                    <div class="steam-request__who">
                        <h4 class="steam-request__name">${esc(name)}</h4>
                        <p class="steam-meta">${a.username ? '@' + esc(a.username) + ' · ' : ''}${esc([a.city, a.country].filter(Boolean).join(', ') || 'Sin ciudad')}</p>
                    </div>
                    <p class="steam-meta steam-request__when">${esc(fmtDate(row.invited_at))}</p>
                </header>
                <dl class="steam-facts">
                    <div><dt>Pidió</dt><dd>${esc(roleLabel(row.role))}${row.location_id ? ' · ' + esc(locationName(row.location_id)) : ''}</dd></div>
                    ${d.proposed_start_date ? `<div><dt>Inicio propuesto</dt><dd>${esc(fmtDate(d.proposed_start_date))}</dd></div>` : ''}
                    ${styles.length ? `<div><dt>Estilos</dt><dd>${styles.map(s => esc(s)).join(' · ')}</dd></div>` : ''}
                </dl>
                ${d.message ? `<blockquote class="steam-quote">${esc(d.message)}</blockquote>` : ''}
                <p class="steam-links-row">
                    ${profile ? `<a href="${esc(profile)}" target="_blank" rel="noopener">Ver perfil →</a>` : ''}
                    ${portfolio ? `<a href="${esc(portfolio)}" target="_blank" rel="noopener noreferrer">Portfolio →</a>` : ''}
                </p>
                <div class="steam-request__decide">
                    <div class="studio-field wo-field">
                        <label class="studio-label wo-label" for="req-role-${esc(row.id)}">Rol</label>
                        <select id="req-role-${esc(row.id)}" class="wo-select" data-req-field="role">${roleOptions(role, APPROVE_ROLES)}</select>
                    </div>
                    <div class="studio-field wo-field">
                        <label class="studio-label wo-label" for="req-loc-${esc(row.id)}">Sede</label>
                        <select id="req-loc-${esc(row.id)}" class="wo-select" data-req-field="location">${locationOptions(row.location_id || '')}</select>
                    </div>
                    <div class="studio-actions">
                        <button type="button" class="wo-btn wo-btn--primary wo-btn--s" data-req-action="accept" data-id="${esc(row.id)}">Aprobar</button>
                        <button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-req-action="reject" data-id="${esc(row.id)}">Rechazar</button>
                    </div>
                </div>
            </article>`;
        }).join('');
        list.querySelectorAll('[data-req-action]').forEach(btn => btn.addEventListener('click', () => decideRequest(btn)));
    }

    function updateTabBadge(n) {
        const tab = document.querySelector('.studio-dash-tab[data-tab="roster"]');
        if (!tab) return;
        let badge = tab.querySelector('.steam-tab-count');
        if (!n) { badge?.remove(); tab.removeAttribute('aria-label'); return; }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'steam-tab-count';
            badge.setAttribute('aria-hidden', 'true');
            tab.appendChild(badge);
        }
        badge.textContent = String(n);
        tab.setAttribute('aria-label', `Equipo, ${n} ${n === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}`);
    }

    async function decideRequest(btn) {
        const id = btn.dataset.id;
        const decision = btn.dataset.reqAction;
        const card = btn.closest('[data-request-id]');
        const row = state.requests.find(r => r.id === id);
        const name = artistName(row && row.artists_db);
        if (decision === 'reject' && !window.confirm(`¿Rechazar la solicitud de ${name}? Le avisamos por email.`)) return;
        const role = card.querySelector('[data-req-field="role"]').value;
        const locationId = card.querySelector('[data-req-field="location"]').value || null;
        card.querySelectorAll('button').forEach(b => { b.disabled = true; });
        const { error } = await memberships().decideRequest(id, decision, decision === 'accept' ? { role, locationId } : {});
        if (error) {
            card.querySelectorAll('button').forEach(b => { b.disabled = false; });
            status('error', friendlyError(error, 'No pudimos guardar la decisión.'));
            return;
        }
        let mailed = false;
        try {
            const res = await api('/api/studio/roster-notify', { method: 'POST', body: { kind: 'membership_request_decision', membership_id: id } });
            mailed = !!res.sent;
        } catch (notifyErr) {
            console.warn('[equipo] aviso de la decisión:', notifyErr && notifyErr.message);
        }
        const done = decision === 'accept' ? `Aprobaste a ${name}: ya está en tu equipo.` : `Rechazaste la solicitud de ${name}.`;
        status('success', done + (mailed ? ' Le avisamos por email.' : ' La decisión quedó guardada; no pudimos confirmar el email.'));
        await Promise.all([loadRequests(), loadMembers()]);
        if (decision === 'accept') askFirstArtistSurvey();
    }

    // Feedback de la beta: encuesta del primer tatuador sumado al equipo. Sale
    // una sola vez por persona (wo-feedback.js lo recuerda en el servidor).
    function askFirstArtistSurvey() {
        if (window.WoFeedback && typeof window.WoFeedback.survey === 'function') window.WoFeedback.survey('primer_tatuador_equipo', { delay: 1500 });
    }

    // La invitación la acepta el artista desde su cuenta: el estudio lo nota
    // cuando el equipo pasa de 0 a 1 o más tatuadores activos (sin contar al dueño).
    function trackTeamGrowth() {
        const st = studio();
        if (!st || !st.id) return;
        const active = state.members.filter(m => m.status === 'active'
            && (m.artist_user_id || (m.artists_db || {}).user_id) !== st.user_id).length;
        const key = 'wo_fb_team:' + st.id;
        let previous = null;
        try {
            previous = window.localStorage.getItem(key);
            window.localStorage.setItem(key, String(active));
        } catch (_) { /* sin almacenamiento: queda la aprobación de solicitudes */ }
        if (previous === '0' && active > 0) askFirstArtistSurvey();
    }

    function avatar(a) {
        const src = safeUrl(a && a.profile_picture);
        if (src) return `<img class="steam-avatar" src="${esc(src)}" alt="" width="44" height="44" loading="lazy" decoding="async">`;
        return `<span class="steam-avatar steam-avatar--initials" aria-hidden="true">${esc(initials(artistName(a)))}</span>`;
    }

    // ------------------------------------------------------- lista del equipo
    async function loadMembers() {
        const container = $('roster-content');
        if (!container) return;
        state.ctx.publishSummary && state.ctx.publishSummary('roster', 'loading');
        container.innerHTML = '<p class="wo-help" role="status">Cargando equipo…</p>';
        const { data: rows, error } = await memberships().listRoster(studio().id);
        if (error) {
            state.ctx.publishSummary && state.ctx.publishSummary('roster', 'error', undefined, error);
            container.innerHTML = `<p class="wo-error-msg" role="alert">No pudimos cargar el equipo. ${esc(friendlyError(error, ''))}</p>`;
            return;
        }
        state.members = rows || [];
        state.ctx.publishSummary && state.ctx.publishSummary('roster', 'ready', state.members);
        renderMembers();
        trackTeamGrowth();
    }

    function visibleMembers() {
        const f = state.filters;
        return state.members.filter(m => {
            const a = m.artists_db || {};
            if (f.q && !normalize([a.name, a.username, a.city].join(' ')).includes(f.q)) return false;
            if (f.role && m.role !== f.role) return false;
            if (f.location && m.location_id !== f.location) return false;
            if (f.status === 'pending' && !['pending_acceptance', 'pending_invite'].includes(m.status)) return false;
            if (f.status && f.status !== 'pending' && m.status !== f.status) return false;
            return true;
        });
    }

    function renderMembers() {
        const container = $('roster-content');
        if (!container) return;
        const counter = $('team-count');
        if (counter) counter.textContent = String(state.members.filter(m => m.status === 'active').length);
        if (!state.members.length) {
            container.innerHTML = `<div class="wo-empty steam-empty"><p class="steam-empty__title">Todavía no hay artistas en tu equipo</p>
                <p class="wo-help">Invita a un artista de We Ötzi, manda una invitación por email o comparte tu enlace de invitación.</p></div>`;
            return;
        }
        const rows = visibleMembers();
        if (!rows.length) {
            container.innerHTML = '<p class="wo-help steam-empty">No hay artistas con estos filtros.</p>';
            return;
        }
        container.innerHTML = `<ul class="steam-list" aria-label="Artistas del equipo">${rows.map(m => {
            const a = m.artists_db || {};
            const name = artistName(a);
            const since = m.status === 'active' || m.status === 'paused'
                ? (m.started_at ? 'Desde ' + fmtDate(m.started_at) : '')
                : (m.invited_at ? 'Invitado el ' + fmtDate(m.invited_at) : '');
            const split = m.revenue_split_pct == null ? '' : `${Number(m.revenue_split_pct)}% para el artista`;
            return `<li class="steam-row" data-id="${esc(m.id)}">
                ${avatar(a)}
                <div class="steam-row__main">
                    <p class="steam-row__name">${esc(name)}</p>
                    <p class="steam-meta">${a.username ? '@' + esc(a.username) : ''}${a.username && since ? ' · ' : ''}${esc(since)}</p>
                </div>
                <p class="steam-row__cell"><span class="steam-key">Rol</span>${esc(roleLabel(m.role))}</p>
                <p class="steam-row__cell"><span class="steam-key">Sede</span>${esc(locationName(m.location_id))}</p>
                <p class="steam-row__cell"><span class="steam-key">Reparto</span>${esc(split || 'Sin definir')}</p>
                <p class="steam-row__cell steam-row__status">${statusBadge(m.status)}</p>
                <div class="steam-row__actions">
                    <button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-member-action="open" data-id="${esc(m.id)}" aria-label="Editar el vínculo con ${esc(name)}">Editar</button>
                    ${m.status === 'active'
                        ? `<button type="button" class="wo-btn wo-btn--danger wo-btn--s" data-member-action="end" data-id="${esc(m.id)}" aria-label="Desvincular a ${esc(name)}">Desvincular</button>`
                        : (m.status === 'paused'
                            ? `<button type="button" class="wo-btn wo-btn--secondary wo-btn--s" data-member-action="resume" data-id="${esc(m.id)}">Reactivar</button>`
                            : `<button type="button" class="wo-btn wo-btn--danger wo-btn--s" data-member-action="cancel" data-id="${esc(m.id)}" aria-label="Cancelar la invitación a ${esc(name)}">Cancelar invitación</button>`)}
                </div>
            </li>`;
        }).join('')}</ul>`;
        container.querySelectorAll('[data-member-action]').forEach(btn => btn.addEventListener('click', () => onMemberAction(btn)));
    }

    async function onMemberAction(btn) {
        const m = state.members.find(x => x.id === btn.dataset.id);
        if (!m) return;
        const action = btn.dataset.memberAction;
        if (action === 'open') return openLinkDrawer(m, btn);
        if (action === 'end') return openEndModal(m, btn);
        if (action === 'cancel') return cancelInvitation(m);
        if (action === 'resume') return resume(m);
    }

    async function cancelInvitation(m) {
        if (!window.confirm(`¿Cancelar la invitación a ${artistName(m.artists_db)}?`)) return;
        const { error } = await memberships().deleteMembership(m.id);
        if (error) { status('error', friendlyError(error, 'No pudimos cancelar la invitación.')); return; }
        status('success', 'Invitación cancelada.');
        closeLayer();
        await loadMembers();
    }

    async function resume(m) {
        const { error } = await memberships().resumeMembership(m.id);
        if (error) { status('error', friendlyError(error, 'No pudimos reactivar el vínculo.')); return; }
        status('success', `Reactivaste el vínculo con ${artistName(m.artists_db)}.`);
        closeLayer();
        await loadMembers();
    }

    // ------------------------------------------- capa (drawer / modal) común
    function openLayer(html, trigger, { modal = false } = {}) {
        closeLayer({ restoreFocus: false });
        state.returnFocus = trigger || document.activeElement;
        const layer = document.createElement('div');
        layer.className = 'steam-layer' + (modal ? ' steam-layer--modal' : '');
        layer.id = 'steam-layer';
        layer.innerHTML = `<div class="steam-scrim" data-layer-close></div>${html}`;
        document.body.appendChild(layer);
        document.body.classList.add('steam-layer-open');
        layer.querySelectorAll('[data-layer-close]').forEach(el => el.addEventListener('click', () => closeLayer()));
        layer.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); closeLayer(); }
            if (event.key === 'Tab') trapFocus(event, layer);
        });
        const dialog = layer.querySelector('[role="dialog"]');
        dialog?.focus({ preventScroll: true });
        return layer;
    }

    function closeLayer({ restoreFocus = true } = {}) {
        const layer = $('steam-layer');
        if (!layer) return;
        layer.remove();
        document.body.classList.remove('steam-layer-open');
        if (restoreFocus && state.returnFocus && state.returnFocus.isConnected) state.returnFocus.focus();
        state.returnFocus = null;
    }

    function trapFocus(event, layer) {
        const nodes = [...layer.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    // ------------------------------------------------- E-TEAM-03 · vínculo
    async function openLinkDrawer(m, trigger) {
        const a = m.artists_db || {};
        const name = artistName(a);
        const locked = !!m.current_contract_id;
        const profile = a.username && state.ctx.appUrl ? state.ctx.appUrl('/artist/profile?artist=' + encodeURIComponent(a.username)) : '';
        const layer = openLayer(`<aside class="steam-drawer" role="dialog" aria-modal="true" aria-labelledby="steam-drawer-title" tabindex="-1">
            <header class="steam-drawer__head">
                <p class="wo-eyebrow">Equipo · ${esc(STATUS_LABELS[m.status] || m.status)}</p>
                <h3 class="steam-drawer__title" id="steam-drawer-title">Vínculo con ${esc(name)}</h3>
                <button type="button" class="wo-iconbtn steam-close" data-layer-close aria-label="Cerrar"><i data-wo-icon="x" aria-hidden="true"></i></button>
            </header>
            <form class="steam-drawer__body" id="steam-link-form" novalidate>
                <dl class="steam-facts">
                    <div><dt>Estancia</dt><dd>${esc(m.started_at ? 'Desde ' + fmtDate(m.started_at) : (m.invited_at ? 'Invitado el ' + fmtDate(m.invited_at) : 'Sin fecha'))}</dd></div>
                    <div><dt>Origen</dt><dd>${m.initiated_by === 'artist' ? 'Lo pidió el artista' : 'Invitación del estudio'}</dd></div>
                </dl>
                <div class="studio-form-grid">
                    <div class="studio-field wo-field">
                        <label class="studio-label wo-label" for="steam-link-role">Rol</label>
                        <select id="steam-link-role" class="wo-select" ${locked ? 'disabled aria-describedby="steam-link-locked"' : ''}>${roleOptions(m.role)}</select>
                    </div>
                    <div class="studio-field wo-field">
                        <label class="studio-label wo-label" for="steam-link-location">Sede</label>
                        <select id="steam-link-location" class="wo-select">${locationOptions(m.location_id || '')}</select>
                    </div>
                    <div class="studio-field wo-field">
                        <label class="studio-label wo-label" for="steam-link-split">Reparto para el artista (%)</label>
                        <input id="steam-link-split" class="wo-input" type="number" inputmode="decimal" min="0" max="100" step="1" value="${m.revenue_split_pct ?? ''}" ${locked ? 'disabled aria-describedby="steam-link-locked"' : ''}>
                    </div>
                    <div class="studio-field wo-field studio-form-full">
                        <label class="studio-label wo-label" for="steam-link-notes">Notas internas</label>
                        <textarea id="steam-link-notes" class="wo-textarea" rows="3" maxlength="1000">${esc(m.notes || '')}</textarea>
                    </div>
                </div>
                ${locked ? '<p class="wo-help" id="steam-link-locked">Este vínculo tiene un contrato vigente: el rol y el reparto se cambian con una nueva versión del contrato.</p>' : ''}
                <section class="steam-conditions" aria-label="Condiciones de la invitación"><p class="wo-help">Cargando condiciones…</p></section>
                <p class="steam-links-row">
                    ${profile ? `<a href="${esc(profile)}" target="_blank" rel="noopener">Ver perfil →</a>` : ''}
                    <a href="#roster-change-requests" data-jump-changes>Cambios solicitados →</a>
                </p>
                <p class="wo-error-msg" role="alert" data-form-error hidden></p>
                <footer class="steam-drawer__foot">
                    <button type="submit" class="wo-btn wo-btn--primary">Guardar</button>
                    ${m.status === 'active' ? '<button type="button" class="wo-btn wo-btn--secondary" data-drawer-action="pause">Pausar</button>' : ''}
                    ${m.status === 'paused' ? '<button type="button" class="wo-btn wo-btn--secondary" data-drawer-action="resume">Reactivar</button>' : ''}
                    ${m.status === 'active' ? '<button type="button" class="wo-btn wo-btn--danger" data-drawer-action="end">Desvincular</button>' : ''}
                    ${['pending_acceptance', 'pending_invite'].includes(m.status) ? '<button type="button" class="wo-btn wo-btn--danger" data-drawer-action="cancel">Cancelar invitación</button>' : ''}
                </footer>
            </form>
        </aside>`, trigger);
        layer.querySelector('[data-jump-changes]')?.addEventListener('click', event => {
            event.preventDefault();
            closeLayer({ restoreFocus: false });
            const box = $('roster-change-requests');
            if (box) { box.hidden = false; box.scrollIntoView({ behavior: 'smooth' }); }
        });
        layer.querySelectorAll('[data-drawer-action]').forEach(btn => btn.addEventListener('click', async () => {
            const act = btn.dataset.drawerAction;
            if (act === 'end') { closeLayer({ restoreFocus: false }); openEndModal(m, trigger); }
            else if (act === 'cancel') cancelInvitation(m);
            else if (act === 'resume') resume(m);
            else if (act === 'pause') {
                if (!window.confirm(`¿Pausar el vínculo con ${name}? Deja de figurar en tu equipo público hasta que lo reactives.`)) return;
                const { error } = await memberships().pauseMembership(m.id);
                if (error) { showFormError(layer, friendlyError(error, 'No pudimos pausar el vínculo.')); return; }
                status('success', `Pausaste el vínculo con ${name}.`);
                closeLayer();
                await loadMembers();
            }
        }));
        layer.querySelector('#steam-link-form').addEventListener('submit', event => { event.preventDefault(); saveLink(m, layer); });
        renderConditions(m, layer);
    }

    async function renderConditions(m, layer) {
        const host = layer.querySelector('.steam-conditions');
        if (!host || typeof memberships().getInvitationDetails !== 'function') return;
        const { data: d } = await memberships().getInvitationDetails(m.id);
        if (!layer.isConnected) return;
        if (!d) { host.innerHTML = '<p class="wo-help">Sin condiciones cargadas para este vínculo.</p>'; return; }
        const list = (title, items) => (Array.isArray(items) && items.length
            ? `<div><dt>${esc(title)}</dt><dd><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></dd></div>` : '');
        const dates = [d.proposed_start_date && fmtDate(d.proposed_start_date), d.proposed_end_date && fmtDate(d.proposed_end_date)].filter(Boolean).join(' – ');
        host.innerHTML = `<h4 class="steam-subtitle">Condiciones de la invitación</h4><dl class="steam-facts">
            ${dates ? `<div><dt>Fechas propuestas</dt><dd>${esc(dates)}</dd></div>` : ''}
            ${d.message ? `<div><dt>Mensaje</dt><dd>${esc(d.message)}</dd></div>` : ''}
            ${list('Incluye', d.studio_provides)}${list('Expectativas', d.artist_expectations)}${list('Requisitos', d.requirements)}
            ${d.contact_name || d.contact_email ? `<div><dt>Contacto</dt><dd>${esc([d.contact_name, d.contact_title, d.contact_email].filter(Boolean).join(' · '))}</dd></div>` : ''}
        </dl>`;
    }

    function showFormError(layer, message) {
        if (window.WoNeutralEs) message = window.WoNeutralEs.neutralize(message); // la base todavía puede responder en voseo
        const node = layer.querySelector('[data-form-error]');
        if (!node) { status('error', message); return; }
        node.textContent = message;
        node.hidden = !message;
    }

    async function saveLink(m, layer) {
        const patch = {
            location_id: layer.querySelector('#steam-link-location').value || null,
            notes: (layer.querySelector('#steam-link-notes').value || '').trim() || null
        };
        if (!m.current_contract_id) {
            const splitRaw = layer.querySelector('#steam-link-split').value;
            const split = splitRaw === '' ? null : Number(splitRaw);
            if (split !== null && (!Number.isFinite(split) || split < 0 || split > 100)) {
                showFormError(layer, 'El reparto va de 0 a 100.');
                return;
            }
            patch.role = layer.querySelector('#steam-link-role').value;
            patch.revenue_split_pct = split;
        }
        const submit = layer.querySelector('button[type="submit"]');
        setBusy(submit, true, 'Guardando…');
        const { error } = await memberships().updateMembership(m.id, patch);
        setBusy(submit, false, 'Guardar');
        if (error) { showFormError(layer, friendlyError(error, 'No pudimos guardar los cambios.')); return; }
        status('success', 'Cambios guardados.');
        closeLayer();
        await loadMembers();
    }

    // ------------------------------------------ E-TEAM-04 · finalizar
    async function openEndModal(m, trigger) {
        const name = artistName(m.artists_db);
        const today = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
        const layer = openLayer(`<div class="wo-modal steam-modal" role="dialog" aria-modal="true" aria-labelledby="steam-end-title" tabindex="-1">
            <h3 class="steam-drawer__title" id="steam-end-title">Finalizar colaboración</h3>
            <p class="wo-help">${esc(name)} deja tu equipo. Su perfil personal queda intacto y el vínculo queda en el historial.</p>
            <form id="steam-end-form" novalidate>
                <dl class="steam-facts"><div><dt>Fecha de fin</dt><dd>Hoy, ${esc(today)}</dd></div></dl>
                <div class="studio-field wo-field">
                    <label class="studio-label wo-label" for="steam-end-reason">Motivo (opcional)</label>
                    <textarea id="steam-end-reason" class="wo-textarea" rows="3" maxlength="500" placeholder="Queda como nota interna del vínculo."></textarea>
                </div>
                <div class="steam-sessions" aria-live="polite"><p class="wo-help">Revisando sesiones futuras…</p></div>
                <p class="wo-error-msg" role="alert" data-form-error hidden></p>
                <div class="wo-modal-actions steam-drawer__foot">
                    <button type="button" class="wo-btn wo-btn--secondary" data-layer-close>Volver</button>
                    <button type="submit" class="wo-btn wo-btn--danger">Finalizar colaboración</button>
                </div>
            </form>
        </div>`, trigger, { modal: true });
        loadFutureSessions(m, layer);
        layer.querySelector('#steam-end-form').addEventListener('submit', event => { event.preventDefault(); endMembership(m, layer); });
    }

    async function loadFutureSessions(m, layer) {
        const host = layer.querySelector('.steam-sessions');
        if (!host || typeof memberships().listFutureBookingsForArtist !== 'function') { if (host) host.innerHTML = ''; return; }
        const { data: rows, error } = await memberships().listFutureBookingsForArtist(studio().id, m.artist_user_id || (m.artists_db || {}).user_id);
        if (!layer.isConnected) return;
        const open = (rows || []).filter(r => !/cancel|complet|done/i.test(String(r.status || '')));
        if (error || !open.length) { host.innerHTML = '<p class="wo-help">No tiene sesiones futuras agendadas en tu estudio.</p>'; return; }
        host.innerHTML = `<div class="wo-alert--warning steam-warning" role="note"><p><strong>${open.length} ${open.length === 1 ? 'sesión futura' : 'sesiones futuras'}</strong> de este artista en tu estudio. Reasígnalas o cancélalas desde Operaciones → Agenda.</p>
            <ul>${open.slice(0, 5).map(r => `<li>${esc(fmtDate(r.starts_at))}${r.client_name ? ' · ' + esc(r.client_name) : ''}</li>`).join('')}</ul></div>`;
    }

    async function endMembership(m, layer) {
        const reason = (layer.querySelector('#steam-end-reason').value || '').trim();
        const submit = layer.querySelector('button[type="submit"]');
        setBusy(submit, true, 'Finalizando…');
        if (reason) {
            const stamp = new Date().toLocaleDateString('es-AR');
            const notes = [m.notes, `Fin de la colaboración (${stamp}): ${reason}`].filter(Boolean).join('\n').slice(0, 2000);
            await memberships().updateMembership(m.id, { notes });
        }
        const { error } = await memberships().endMembership(m.id);
        setBusy(submit, false, 'Finalizar colaboración');
        if (error) { showFormError(layer, friendlyError(error, 'No pudimos finalizar la colaboración.')); return; }
        closeLayer();
        status('success', `Finalizaste la colaboración con ${artistName(m.artists_db)}.`);
        const artistUserId = m.artist_user_id || (m.artists_db || {}).user_id;
        if (artistUserId && window.WeOtziReviews && window.confirm('¿Quieres calificar al artista ahora?')) {
            window.WeOtziReviews.openReviewModal({
                title: 'Calificar artista',
                reviewerType: 'studio',
                contextType: 'studio_membership',
                contextId: m.id,
                revieweeType: 'artist',
                revieweeUserId: artistUserId,
                revieweeDisplayName: artistName(m.artists_db)
            });
        }
        await loadMembers();
    }

    // --------------------------------------------- E-TEAM-02 · invitar
    function wireInviteSearch() {
        const input = $('invite-search');
        const sugg = $('invite-suggestions');
        if (!input || !sugg || input.dataset.inviteWired === 'true') return;
        input.dataset.inviteWired = 'true';
        let timer = null;
        const hide = () => { sugg.hidden = true; input.setAttribute('aria-expanded', 'false'); };
        input.addEventListener('input', () => {
            const q = input.value.trim();
            state.inviteChosen = null;
            $('invite-chosen')?.setAttribute('hidden', '');
            if (timer) clearTimeout(timer);
            if (q.length < 2) { sugg.innerHTML = ''; hide(); return; }
            timer = setTimeout(async () => {
                const { data: rows, error } = await data().Artists.searchByUsernameOrName(q.replace(/^@/, ''));
                if (q !== input.value.trim()) return;
                if (error) { status('error', 'No pudimos buscar artistas. Prueba de nuevo.'); return; }
                const openIds = new Set(state.members.concat(state.requests).map(m => m.artist_user_id || (m.artists_db || {}).user_id));
                state.inviteHits = rows || [];
                sugg.innerHTML = state.inviteHits.length
                    ? state.inviteHits.map((a, i) => {
                        const inTeam = openIds.has(a.user_id);
                        return `<button type="button" role="option" class="studio-search-result" data-index="${i}" ${inTeam ? 'disabled' : ''}>
                            <span><strong>${esc(artistName(a))}</strong><small>@${esc(a.username || '')} · ${esc([a.city, a.country].filter(Boolean).join(', ') || 'Sin ciudad')}</small></span>
                            ${inTeam ? '<span class="wo-badge wo-badge--s wo-badge--outline">Ya en tu equipo</span>' : ''}
                        </button>`;
                    }).join('')
                    : `<p class="wo-help steam-noresult">No encontramos artistas con "${esc(q)}". Si no tiene cuenta, invítalo por email más abajo.</p>`;
                sugg.hidden = false;
                input.setAttribute('aria-expanded', 'true');
                if (!state.inviteHits.length) $('team-email-invite')?.removeAttribute('hidden');
                sugg.querySelectorAll('[data-index]').forEach(btn => btn.addEventListener('click', () => {
                    const a = state.inviteHits[Number(btn.dataset.index)];
                    state.inviteChosen = a;
                    input.value = artistName(a);
                    const chosen = $('invite-chosen');
                    if (chosen) {
                        chosen.innerHTML = `${avatar(a)}<span><strong>${esc(artistName(a))}</strong> · @${esc(a.username || '')}</span>`
                            + (a.username && state.ctx.appUrl ? ` <a href="${esc(state.ctx.appUrl('/artist/profile?artist=' + encodeURIComponent(a.username)))}" target="_blank" rel="noopener">Ver perfil →</a>` : '');
                        chosen.hidden = false;
                    }
                    hide();
                }));
            }, 220);
        });
        input.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    }

    function inviteDetailsFromForm() {
        const val = id => ($(id)?.value || '').trim();
        return {
            message: val('invite-message') || null,
            proposed_start_date: val('invite-start') || null,
            proposed_end_date: val('invite-end') || null,
            studio_provides: lines(val('invite-provides')),
            artist_expectations: lines(val('invite-expectations')),
            requirements: lines(val('invite-requirements')),
            contact_name: val('invite-contact-name') || null,
            contact_email: val('invite-contact-email') || null,
            contact_title: val('invite-contact-title') || null
        };
    }

    async function onInviteSubmit(event) {
        event.preventDefault();
        const chosen = state.inviteChosen;
        if (!chosen) { status('error', 'Elige un artista de las sugerencias (o invítalo por email si no tiene cuenta).'); $('invite-search')?.focus(); return; }
        const splitRaw = $('invite-split')?.value || '';
        const split = splitRaw === '' ? null : Number(splitRaw);
        if (split !== null && (!Number.isFinite(split) || split < 0 || split > 100)) { status('error', 'El reparto va de 0 a 100.'); return; }
        const details = inviteDetailsFromForm();
        if (details.proposed_start_date && details.proposed_end_date && details.proposed_end_date < details.proposed_start_date) {
            status('error', 'La fecha de fin tiene que ser igual o posterior al inicio.'); return;
        }
        if (details.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.contact_email)) {
            status('error', 'Revisa el email de contacto.'); return;
        }
        const button = $('invite-send');
        setBusy(button, true, 'Enviando…');
        const { data: inserted, error } = await memberships().inviteArtist({
            studio_id: studio().id,
            artist_user_id: chosen.user_id,
            location_id: $('invite-location')?.value || null,
            role: $('invite-role')?.value || 'resident',
            revenue_split_pct: split,
            status: 'pending_acceptance',
            invited_at: new Date().toISOString(),
            invited_by_user_id: studio().user_id || null
        });
        if (error) {
            setBusy(button, false, 'Enviar invitación');
            status('error', friendlyError(error, 'No pudimos enviar la invitación.'));
            return;
        }
        const membershipId = inserted && inserted.id;
        const hasDetails = Object.values(details).some(v => Array.isArray(v) ? v.length : v);
        if (membershipId && hasDetails) {
            const saved = await memberships().saveInvitationDetails(membershipId, details);
            if (saved && saved.error) console.warn('[equipo] condiciones de la invitación:', saved.error.message);
        }
        let mailed = false;
        if (membershipId && state.ctx.notifyStudio) {
            try { await state.ctx.notifyStudio({ kind: 'roster_invite', membership_id: membershipId }); mailed = true; } catch (notifyErr) {
                console.warn('[equipo] aviso de la invitación:', notifyErr && notifyErr.message);
            }
        }
        setBusy(button, false, 'Enviar invitación');
        $('team-invite')?.reset();
        state.inviteChosen = null;
        $('invite-chosen')?.setAttribute('hidden', '');
        toggleInvite(false);
        status(mailed ? 'success' : 'info', mailed
            ? `Invitación enviada a ${artistName(chosen)}. Le mandamos un email.`
            : `Invitación guardada: ${artistName(chosen)} la ve en su panel. No pudimos confirmar el email.`);
        await loadMembers();
    }

    async function onEmailInviteSubmit(event) {
        event.preventDefault();
        const email = ($('email-invite-email')?.value || '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { status('error', 'Escribe un email válido.'); $('email-invite-email')?.focus(); return; }
        const button = $('email-invite-send');
        setBusy(button, true, 'Enviando…');
        try {
            const res = await api('/api/studio/invite-email', {
                method: 'POST',
                body: {
                    studio_id: studio().id,
                    email,
                    name: ($('email-invite-name')?.value || '').trim() || null,
                    role: $('invite-role')?.value || 'resident',
                    location_id: $('invite-location')?.value || null,
                    message: ($('invite-message')?.value || '').trim() || null
                }
            });
            $('team-email-invite')?.reset();
            status('success', res.message || 'Invitación enviada.');
            await Promise.all([loadMembers(), loadLinks()]);
        } catch (error) {
            status('error', friendlyError(error, 'No pudimos enviar la invitación.'));
        } finally {
            setBusy(button, false, 'Invitar por email');
        }
    }

    // ------------------------------------------- enlace de invitación
    async function loadLinks() {
        const list = $('team-links-list');
        if (!list) return;
        try {
            const res = await api('/api/studio/invite-links?studio_id=' + encodeURIComponent(studio().id));
            state.links = res.links || [];
        } catch (error) {
            list.innerHTML = `<p class="wo-error-msg" role="alert">${esc(friendlyError(error, 'No pudimos cargar tus enlaces.'))}</p>`;
            return;
        }
        renderLinks();
    }

    const LINK_STATUS = { active: 'Activo', expired: 'Vencido', revoked: 'Desactivado', exhausted: 'Sin usos' };

    function renderLinks() {
        const list = $('team-links-list');
        if (!list) return;
        const rows = state.links.filter(l => !l.invitee_email || l.status === 'active');
        if (!rows.length) { list.innerHTML = '<p class="wo-help">Todavía no generaste enlaces.</p>'; return; }
        list.innerHTML = `<ul class="steam-linklist">${rows.map(l => `<li class="steam-linkrow">
            <div>
                <p class="steam-row__name">${esc(l.label || (l.invitee_email ? 'Invitación a ' + (l.invitee_name || l.invitee_email) : roleLabel(l.role)))}</p>
                <p class="steam-meta">${esc(roleLabel(l.role))} · ${esc(l.location_id ? locationName(l.location_id) : 'Cualquier sede')} · ${l.requires_approval ? 'Con aprobación' : 'Alta directa'}</p>
                <p class="steam-meta">${esc(l.uses_count)}${l.max_uses ? ' de ' + esc(l.max_uses) : ''} ${l.uses_count === 1 ? 'uso' : 'usos'} · ${l.status === 'active' ? 'Vence el ' + esc(fmtDate(l.expires_at)) : esc(LINK_STATUS[l.status] || l.status)}</p>
            </div>
            <div class="steam-linkrow__side">
                <span class="wo-badge wo-badge--s ${l.status === 'active' ? 'wo-badge--success' : 'wo-badge--outline'}">${esc(LINK_STATUS[l.status] || l.status)}</span>
                ${l.status === 'active' ? `<button type="button" class="wo-btn wo-btn--danger wo-btn--s" data-revoke="${esc(l.id)}">Desactivar</button>` : ''}
            </div>
        </li>`).join('')}</ul>`;
        list.querySelectorAll('[data-revoke]').forEach(btn => btn.addEventListener('click', () => revokeLink(btn)));
    }

    async function revokeLink(btn) {
        if (!window.confirm('¿Desactivar este enlace? Quien lo tenga ya no va a poder usarlo.')) return;
        setBusy(btn, true);
        try {
            await api(`/api/studio/invite-links/${encodeURIComponent(btn.dataset.revoke)}?studio_id=${encodeURIComponent(studio().id)}`, { method: 'DELETE' });
            status('success', 'Enlace desactivado.');
            await loadLinks();
        } catch (error) {
            setBusy(btn, false);
            status('error', friendlyError(error, 'No pudimos desactivar el enlace.'));
        }
    }

    async function onLinkSubmit(event) {
        event.preventDefault();
        const button = $('link-generate');
        setBusy(button, true, 'Generando…');
        try {
            const res = await api('/api/studio/invite-links', {
                method: 'POST',
                body: {
                    studio_id: studio().id,
                    role: $('link-role')?.value || 'resident',
                    location_id: $('link-location')?.value || null,
                    requires_approval: $('link-approval') ? $('link-approval').checked : true,
                    ttl_days: Number($('link-ttl')?.value || 30),
                    max_uses: $('link-max')?.value || null,
                    label: ($('link-label')?.value || '').trim() || null
                }
            });
            showGeneratedLink(res.link);
            await loadLinks();
        } catch (error) {
            status('error', friendlyError(error, 'No pudimos generar el enlace.'));
        } finally {
            setBusy(button, false, 'Generar enlace');
        }
    }

    function showGeneratedLink(link) {
        const box = $('link-result');
        if (!box || !link || !link.url) return;
        const text = `${studio().name || 'Nuestro estudio'} te invita a sumarte a su equipo en We Ötzi: ${link.url}`;
        box.innerHTML = `<label class="studio-label wo-label" for="link-result-url">Tu enlace (se muestra una sola vez: cópialo ahora)</label>
            <div class="steam-copyrow">
                <input id="link-result-url" class="wo-input" type="text" readonly value="${esc(link.url)}">
                <button type="button" class="wo-btn wo-btn--accent wo-btn--s" data-copy>Copiar</button>
            </div>
            <p class="steam-links-row">
                <a href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp →</a>
                <a href="mailto:?subject=${encodeURIComponent('Invitación a ' + (studio().name || 'nuestro estudio'))}&body=${encodeURIComponent(text)}">Email →</a>
                ${navigator.share ? '<button type="button" class="steam-linkbtn" data-share>Compartir →</button>' : ''}
            </p>
            <p class="wo-help">Vence el ${esc(fmtDate(link.expires_at))}. ${link.requires_approval ? 'Cada alta queda pendiente hasta que la apruebes.' : 'Quien lo use entra directo a tu equipo.'}</p>
            <p class="steam-copied" role="status" aria-live="polite"></p>`;
        box.hidden = false;
        const input = box.querySelector('#link-result-url');
        box.querySelector('[data-copy]').addEventListener('click', async () => {
            const done = box.querySelector('.steam-copied');
            try { await navigator.clipboard.writeText(link.url); done.textContent = 'Copiado.'; }
            catch (_) { input.select(); done.textContent = 'Selecciónalo y cópialo con Ctrl+C.'; }
        });
        box.querySelector('[data-share]')?.addEventListener('click', () => {
            navigator.share({ title: 'Invitación a ' + (studio().name || 'nuestro estudio'), text, url: link.url }).catch(() => {});
        });
        input.focus();
        input.select();
    }

    window.WeOtziStudioTeam = {
        init,
        reload: () => Promise.all([loadRequests(), loadMembers(), loadLinks()]),
        _friendlyError: friendlyError
    };
})();
