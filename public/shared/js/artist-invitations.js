// ============================================
// Artist Invitations
// Standalone page where artists see pending studio invitations and accept/reject.
// Reuses studio_artist_memberships rows: pending_acceptance → active or rejected.
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

    async function renderPending(userId) {
        const list = document.getElementById('invitations-list');
        const { data, error } = await WeotziData.StudioMemberships.listPendingForArtist(userId);

        if (error) { list.innerHTML = '<em>' + escapeHtml(error.message) + '</em>'; return; }
        if (!data || data.length === 0) {
            list.innerHTML = '<p class="studio-help">No tenés invitaciones pendientes.</p>';
            return;
        }

        list.innerHTML = data.map(m => {
            const s = m.studios || {};
            const loc = m.location || {};
            return `
                <article class="studio-roster-card" data-id="${escapeAttr(m.id)}" style="cursor:default;display:grid;grid-template-columns:120px 1fr;align-items:stretch;max-width:100%;margin-bottom:12px;">
                    <div class="pic" style="${s.logo_image ? `background-image:url('${cssEscape(s.logo_image)}');` : (s.cover_image ? `background-image:url('${cssEscape(s.cover_image)}');` : '')}"></div>
                    <div class="body" style="padding:14px;">
                        <strong>${escapeHtml(s.name || 'Estudio')}</strong>
                        <div class="role" style="margin-top:4px;">Te invitan como <strong>${escapeHtml(ROLE_LABELS[m.role] || m.role)}</strong></div>
                        <div class="studio-help" style="margin-top:6px;">
                            ${escapeHtml(loc.label || 'Sin sede asignada')}${loc.city ? ' · ' + escapeHtml([loc.city, loc.country].filter(Boolean).join(', ')) : ''}
                        </div>
                        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
                            <button class="studio-btn studio-btn-primary" data-action="accept" data-id="${escapeAttr(m.id)}"><i class="fa-solid fa-check"></i> Aceptar</button>
                            <button class="studio-btn studio-btn-ghost"   data-action="reject" data-id="${escapeAttr(m.id)}"><i class="fa-solid fa-xmark"></i> Rechazar</button>
                            ${s.slug ? `<a class="studio-btn" href="/studio/profile/?studio=${encodeURIComponent(s.slug)}" target="_blank">Ver perfil</a>` : ''}
                        </div>
                    </div>
                </article>
            `;
        }).join('');

        list.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => decide(btn.dataset.action, btn.dataset.id, userId));
        });
    }

    async function renderActive(userId) {
        const list = document.getElementById('active-list');
        const { data, error } = await WeotziData.StudioMemberships.listActiveForArtist(userId);

        if (error) { list.innerHTML = '<em>' + escapeHtml(error.message) + '</em>'; return; }
        if (!data || data.length === 0) {
            list.innerHTML = '<p class="studio-help">Aún no tenés memberships activas.</p>';
            return;
        }
        list.innerHTML = `
            <table class="studio-roster-table">
                <thead><tr><th>Estudio</th><th>Rol</th><th>Inicio</th><th>Acciones</th></tr></thead>
                <tbody>
                    ${data.map(m => {
                        const s = m.studios || {};
                        return `<tr>
                            <td><strong>${escapeHtml(s.name || 'Estudio')}</strong></td>
                            <td><span class="studio-role-pill role-${escapeHtml(m.role)}">${escapeHtml(ROLE_LABELS[m.role] || m.role)}</span></td>
                            <td>${m.started_at ? new Date(m.started_at).toLocaleDateString('es-AR') : '—'}</td>
                            <td>
                                ${s.slug ? `<a class="studio-locations-add" href="/studio/profile/?studio=${encodeURIComponent(s.slug)}" target="_blank" style="border-style:solid;padding:4px 8px;text-decoration:none;color:var(--fg);">Ver perfil</a>` : ''}
                                <button class="studio-location-row-remove" data-action="leave" data-id="${escapeAttr(m.id)}">Salir</button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
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
