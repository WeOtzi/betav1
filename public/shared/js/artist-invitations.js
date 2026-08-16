// ============================================
// Artist Invitations (DS Bauhaus)
// Standalone page where artists see pending studio invitations and accept/reject.
// Reuses studio_artist_memberships rows: pending_acceptance → active or rejected.
// La invitación más reciente se muestra como tarjeta destacada (fondo ink);
// el resto como filas editoriales.
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;

    const ROLE_LABELS = { resident: 'Residente', itinerant: 'Itinerante', guest: 'Guest', manager: 'Manager' };

    document.addEventListener('DOMContentLoaded', async () => {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) {
            window.location.href = '/artist/login?returnTo=' + encodeURIComponent('/artist/invitations');
            return;
        }
        await Promise.all([renderPending(session.user.id), renderActive(session.user.id)]);
    });

    function formatInviteDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }).replace('.', '');
    }

    function locationText(loc) {
        if (!loc) return 'Sin sede asignada';
        const cityCountry = [loc.city, loc.country].filter(Boolean).join(', ');
        return cityCountry || loc.label || 'Sin sede asignada';
    }

    function studioLinkHtml(s, dark) {
        if (!s.slug) return '';
        return `<a class="${dark ? 'inv-link-dark' : 'inv-link'}" href="/studio/profile/?studio=${encodeURIComponent(s.slug)}" target="_blank">Ver estudio →</a>`;
    }

    function renderFeature(m) {
        const s = m.studios || {};
        const loc = m.location || {};
        const cover = s.cover_image || s.logo_image || '';
        const role = ROLE_LABELS[m.role] || m.role;
        return `
            <article class="inv-feature" data-id="${escapeAttr(m.id)}">
                <div class="inv-feature-body">
                    <div class="inv-feature-top">
                        <span class="inv-feature-eyebrow">Invitación${m.invited_at ? ' · ' + escapeHtml(formatInviteDate(m.invited_at)) : ''}</span>
                        <span class="wo-badge wo-badge--accent wo-badge--s">Pendiente</span>
                    </div>
                    <h2 class="inv-feature-name">${escapeHtml(s.name || 'Estudio')}</h2>
                    <span class="inv-feature-meta">${escapeHtml(locationText(loc))} · Te invitan como ${escapeHtml(role)}</span>
                    ${s.tagline ? `<p class="wo-body-s" style="margin:0;color:var(--text-faint);max-width:52ch;">${escapeHtml(s.tagline)}</p>` : ''}
                    <div class="inv-feature-actions">
                        <button class="wo-btn wo-btn--accent wo-btn--hard" data-action="accept" data-id="${escapeAttr(m.id)}">
                            Aceptar <i data-wo-icon="check" class="wo-icon-18" aria-hidden="true"></i>
                        </button>
                        <button class="wo-btn wo-btn--ghost inv-btn-ghost-dark" data-action="reject" data-id="${escapeAttr(m.id)}">Rechazar</button>
                        ${studioLinkHtml(s, true)}
                    </div>
                </div>
                <div class="inv-feature-media" ${cover ? `style="background-image:url('${cssEscape(cover)}')"` : ''}></div>
            </article>
        `;
    }

    function renderRow(m) {
        const s = m.studios || {};
        const loc = m.location || {};
        const role = ROLE_LABELS[m.role] || m.role;
        return `
            <article class="inv-row" data-id="${escapeAttr(m.id)}">
                <span class="inv-row-date">${escapeHtml(formatInviteDate(m.invited_at)) || '—'}</span>
                <div class="inv-row-main">
                    <h3 class="inv-row-name">${escapeHtml(s.name || 'Estudio')}</h3>
                    <div class="inv-row-meta">${escapeHtml(locationText(loc))} · Te invitan como ${escapeHtml(role)}</div>
                </div>
                <span class="wo-tag wo-tag--highlight inv-row-badge">Pendiente</span>
                <div class="inv-row-actions">
                    <button class="wo-btn wo-btn--s" data-action="accept" data-id="${escapeAttr(m.id)}">Aceptar</button>
                    <button class="wo-btn wo-btn--ghost wo-btn--s" data-action="reject" data-id="${escapeAttr(m.id)}">Rechazar</button>
                    ${studioLinkHtml(s, false)}
                </div>
            </article>
        `;
    }

    async function renderPending(userId) {
        const list = document.getElementById('invitations-list');
        const countEl = document.getElementById('inv-count');
        const { data, error } = await WeotziData.StudioMemberships.listPendingForArtist(userId);

        if (error) {
            list.innerHTML = '<div class="wo-alert wo-alert--error">' + escapeHtml(error.message) + '</div>';
            return;
        }

        if (countEl) countEl.textContent = String((data || []).length).padStart(2, '0');

        if (!data || data.length === 0) {
            list.innerHTML = `
                <div class="wo-empty">
                    <i data-wo-icon="mail" aria-hidden="true"></i>
                    <span class="wo-empty-title">No tenés invitaciones pendientes</span>
                    <p>Cuando un estudio te quiera en su roster, la invitación va a aparecer acá.</p>
                </div>
            `;
            return;
        }

        const [first, ...rest] = data;
        list.innerHTML = renderFeature(first) + rest.map(m => renderRow(m)).join('');

        list.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => decide(btn.dataset.action, btn.dataset.id, userId));
        });
    }

    async function renderActive(userId) {
        const list = document.getElementById('active-list');
        const { data, error } = await WeotziData.StudioMemberships.listActiveForArtist(userId);

        if (error) {
            list.innerHTML = '<div class="wo-alert wo-alert--error">' + escapeHtml(error.message) + '</div>';
            return;
        }
        if (!data || data.length === 0) {
            list.innerHTML = '<p class="wo-body-s wo-muted">Todavía no formás parte del roster de ningún estudio.</p>';
            return;
        }
        list.innerHTML = `
            <div style="overflow-x:auto;">
            <table class="wo-table">
                <thead><tr><th>Estudio</th><th>Rol</th><th>Inicio</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${data.map(m => {
                        const s = m.studios || {};
                        return `<tr>
                            <td><strong>${escapeHtml(s.name || 'Estudio')}</strong></td>
                            <td><span class="wo-tag wo-tag--soft">${escapeHtml(ROLE_LABELS[m.role] || m.role)}</span></td>
                            <td class="wo-mono-num">${m.started_at ? new Date(m.started_at).toLocaleDateString('es-AR') : '—'}</td>
                            <td>
                                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                                    ${s.slug ? `<a class="wo-btn wo-btn--ghost wo-btn--s" href="/studio/profile/?studio=${encodeURIComponent(s.slug)}" target="_blank">Ver perfil</a>` : ''}
                                    <button class="wo-btn wo-btn--danger wo-btn--s" data-action="leave" data-id="${escapeAttr(m.id)}">Salir</button>
                                </div>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>
        `;
        list.querySelectorAll('button[data-action="leave"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('¿Salir del roster de este estudio? Tu perfil personal queda intacto.')) return;
                await WeotziData.StudioMemberships.endMembership(btn.dataset.id);
                location.reload();
            });
        });
    }

    async function decide(action, membershipId, userId) {
        const { error } = await WeotziData.StudioMemberships.respondToInvitation(membershipId, userId, action);
        if (error) {
            alert('Error: ' + error.message);
            return;
        }
        location.reload();
    }

    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(v) { return escapeHtml(v); }
    function cssEscape(v) { return String(v).replace(/'/g, "\\'").replace(/"/g, '\\"'); }
})();
