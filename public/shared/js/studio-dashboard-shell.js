/* Studio shell: summary values come only from the authenticated dashboard data. */
(function () {
    'use strict';
    const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    function renderSummary(data) {
        const host = document.getElementById('studio-summary');
        if (!host || !data) return;
        const state = data.state || {};
        const locations = data.locations || [];
        const roster = data.roster || [];
        const spots = data.spots || [];
        const activeLocations = locations.filter(row => row.is_active !== false && !row.archived_at);
        const activeArtists = roster.filter(row => row.status === 'active');
        const activeSpots = spots.filter(row => row.status === 'open' || row.status === 'published' || row.is_active === true);
        const value = (key, count) => state[key] === 'error' ? '—' : state[key] === 'ready' ? String(count) : '…';
        const problem = Object.values(state).includes('error');
        const locationList = state.locations === 'error'
            ? '<p class="studio-status studio-status-error">No pudimos cargar las sedes. Volvé a intentarlo desde Sedes.</p>'
            : state.locations !== 'ready' ? '<p class="studio-help">Cargando sedes…</p>'
            : activeLocations.length ? '<ul class="studio-summary-list">' + activeLocations.map(row => '<li><div><strong>' + escapeHtml(row.label || 'Sede del estudio') + '</strong><small>' + escapeHtml(row.formatted_address || row.address || row.city || 'Completá la dirección en Sedes') + '</small></div>' + (row.is_primary ? '<span class="wo-badge wo-badge--s wo-badge--outline">Principal</span>' : '') + '</li>').join('') + '</ul>'
            : '<p class="studio-help">Todavía no agregaste una sede. Sumá la primera para mostrar tu estudio en el mapa.</p>';
        host.innerHTML = '<div class="studio-summary-metrics" aria-label="Resumen del estudio">' +
            [['locations', activeLocations.length, 'Sedes activas'], ['roster', activeArtists.length, 'Artistas en el equipo'], ['spots', activeSpots.length, 'Spots abiertos']].map(([key, count, label]) => '<div class="studio-summary-metric"><strong>' + value(key, count) + '</strong><span>' + label + '</span></div>').join('') + '</div>' +
            (problem ? '<p class="studio-help">Parte del resumen no está disponible. Podés revisar el detalle en cada sección.</p>' : '') +
            '<div class="studio-panel-grid"><div class="studio-panel-content"><section class="studio-summary-section"><h3>Tus espacios</h3>' + locationList + '<div class="studio-actions"><a class="wo-btn wo-btn--secondary" href="#sedes">Administrar sedes</a></div></section>' +
            '<section class="studio-summary-section"><h3>La actividad de tu estudio</h3><p class="studio-help">Organizá el equipo, publicá oportunidades y llevá el registro de tus trabajos desde un mismo lugar.</p><div class="studio-actions"><a class="wo-btn" href="#ops">Ver operaciones</a><a class="wo-btn wo-btn--secondary" href="#roster">Invitar artistas</a><a class="wo-btn wo-btn--secondary" href="#spots">Administrar Spots</a></div></section></div>' +
            '<aside class="studio-context"><h3>Tu estudio, al día</h3><p>Completá el perfil público y mantené actualizados los datos de cada sede. Los artistas podrán conocer el espacio y las oportunidades que ofrecés.</p><div class="studio-actions"><a class="wo-btn wo-btn--secondary" href="#perfil">Editar perfil</a></div></aside></div>';
    }
    window.addEventListener('studio:dashboard-summary', event => renderSummary(event.detail));
    if (window.WeOtziStudioDashboardSummary) renderSummary(window.WeOtziStudioDashboardSummary);
}());
