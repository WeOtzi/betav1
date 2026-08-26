// ============================================
// Itinerario público de gira (/travel/share?slug=...) — DS Bauhaus.
// Página SIN login: lee el slug con WeotziData.Travel.getBySlug (la policy
// artist_trips_public_shared permite el select anónimo) y muestra ciudad,
// país, fechas y tipo con branding We Ötzi + CTA a /quotation.
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);

    const D = window.WeotziData;
    const TYPE_LABELS = { guest_spot: 'Guest spot', convencion: 'Convención', estudio_invitado: 'Estudio invitado' };
    const STATUS_LABELS = { planificado: 'Planificado', pendiente: 'Pendiente', confirmado: 'Confirmado', finalizado: 'Finalizado' };
    const STATUS_TAG_CLASS = {
        planificado: 'wo-tag',
        pendiente: 'wo-tag wo-tag--highlight',
        confirmado: 'wo-tag wo-tag--info',
        finalizado: 'wo-tag wo-tag--archived',
    };
    const MONTHS_AB = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function pd(dateStr) {
        const [y, m, d] = String(dateStr).split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    function fmtLong(dateStr) {
        const d = pd(dateStr);
        return `${d.getDate()} ${MONTHS_AB[d.getMonth()]} ${d.getFullYear()}`;
    }

    function renderNotFound(root) {
        root.innerHTML = `
            <div class="wo-empty">
                <i data-wo-icon="map" aria-hidden="true"></i>
                <span class="wo-empty-title">Este itinerario no está disponible</span>
                <p>El enlace puede haber sido desactivado por el artista o el viaje ya no existe.</p>
                <a class="wo-btn wo-btn--ghost" href="/inicio">Ir a We Ötzi →</a>
            </div>`;
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const root = document.getElementById('ts-root');
        const slug = new URLSearchParams(location.search).get('slug');
        if (!slug) { renderNotFound(root); return; }

        let trip = null;
        try {
            trip = await D.Travel.getBySlug(slug);
        } catch (err) {
            console.error('[travel-share] error leyendo el itinerario:', err);
        }
        if (!trip) { renderNotFound(root); return; }

        // El nombre del artista es un extra: si la lectura anónima no está
        // permitida, la página degrada sin él.
        let artistName = null;
        try {
            const { data } = await D.Artists.getByUserId(trip.artist_user_id, 'user_id, name, username');
            if (data) artistName = data.name || data.username || null;
        } catch (err) { artistName = null; }

        const status = pd(trip.end_date) < new Date() && trip.status !== 'cancelado' ? 'finalizado' : trip.status;
        const rows = [
            ['Fechas', `${fmtLong(trip.start_date)} – ${fmtLong(trip.end_date)}`],
            ['Tipo de viaje', TYPE_LABELS[trip.trip_type] || trip.trip_type],
        ];
        if (trip.event_name) rows.push(['Evento', trip.event_name]);

        root.innerHTML = `
            <p class="wo-eyebrow tvs-share-eyebrow">Itinerario de gira · We Ötzi</p>
            <h1 class="wo-h1 tvs-share-title">${esc(trip.city)}, ${esc(trip.country)}</h1>
            <p class="tvs-share-artist">${artistName ? `Gira de ${esc(artistName)} · ` : ''}modo lectura</p>

            <div class="tvs-share-card">
                <div class="tvs-card-head">
                    <span class="wo-meta">Resumen del viaje</span>
                    <span class="wo-meta">${esc(STATUS_LABELS[status] || status)}</span>
                </div>
                ${rows.map(([l, v]) => `
                <div class="tvs-row">
                    <span class="wo-meta tvs-row-l">${esc(l)}</span>
                    <span class="tvs-row-v">${esc(v)}</span>
                </div>`).join('')}
                <div class="tvs-row">
                    <span class="wo-meta tvs-row-l">Estado</span>
                    <span class="${STATUS_TAG_CLASS[status] || 'wo-tag'}">${esc(STATUS_LABELS[status] || status)}</span>
                </div>
            </div>

            <div class="tvs-share-cta">
                <p class="tvs-share-note">¿Querés tatuarte durante esta gira? Contá tu idea y coordiná una cita.</p>
                <a class="wo-btn wo-btn--accent wo-btn--hard" href="/quotation">Pedí tu cita →</a>
            </div>`;
    });
})();
