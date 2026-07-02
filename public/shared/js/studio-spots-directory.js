// ============================================
// Public Spots Directory
// Lists all `studio_spots` with status='open', filterable by kind.
// Click a card → modal with full details + Apply CTA.
// Apply requires the visitor to be authenticated as an artist; otherwise we
// route them to /artist/login with a returnTo.
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;

    const KIND_LABELS = { resident: 'Residencia', itinerant: 'Itinerante', guest_spot: 'Guest spot' };
    let spots = [];
    let activeKind = '';

    document.addEventListener('DOMContentLoaded', async () => {
        wireFilters();
        wireModal();
        await loadSpots();
    });

    async function loadSpots() {
        const { data, error } = await WeotziData.StudioSpots.listOpenWithStudioAndLocation();

        if (error) {
            document.getElementById('spots-grid').innerHTML =
                '<em class="studio-help">No pudimos cargar los spots: ' + escapeHtml(error.message) + '</em>';
            return;
        }
        spots = data || [];
        render();
        openSpotFromQuery();
    }

    function render() {
        const grid = document.getElementById('spots-grid');
        const filtered = activeKind ? spots.filter(s => s.kind === activeKind) : spots;
        if (filtered.length === 0) {
            grid.innerHTML = '<em class="studio-help">No hay spots abiertos en esta categoría por ahora.</em>';
            return;
        }
        grid.innerHTML = filtered.map(s => renderCard(s)).join('');
        grid.querySelectorAll('.spot-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                const spot = spots.find(x => x.id === id);
                if (spot) openModal(spot);
            });
        });
    }

    function renderCard(s) {
        const cover = s.cover_image || (s.studios && s.studios.cover_image) || '';
        const studio = s.studios || {};
        const loc = s.location || {};
        const cityCountry = [loc.city, loc.country].filter(Boolean).join(', ');
        const stylesPills = (s.styles_wanted || []).slice(0, 4).map(st =>
            `<span class="studio-style-pill">${escapeHtml(st)}</span>`
        ).join('');
        const splitText = s.revenue_split_pct != null ? `${Number(s.revenue_split_pct).toFixed(0)}%` : '—';

        return `
            <article class="spot-card" data-id="${escapeAttr(s.id)}">
                <div class="spot-card-cover" ${cover ? `style="background-image:url('${cssEscape(cover)}')"` : ''}>
                    <span class="spot-card-kind kind-${escapeAttr(s.kind)}">${escapeHtml(KIND_LABELS[s.kind] || s.kind)}</span>
                </div>
                <div class="spot-card-body">
                    <strong class="spot-card-title">${escapeHtml(s.title)}</strong>
                    <span class="spot-card-meta">
                        <i class="fa-solid fa-building"></i> ${escapeHtml(studio.name || 'Estudio')}<br>
                        <i class="fa-solid fa-location-dot"></i> ${escapeHtml(cityCountry || '—')}<br>
                        <i class="fa-solid fa-percent"></i> Split ${splitText}
                        ${s.stipend_amount ? ` · Stipend ${escapeHtml(String(s.stipend_amount))} ${escapeHtml(s.stipend_currency || '')}` : ''}
                    </span>
                    ${stylesPills ? `<div class="spot-card-styles">${stylesPills}</div>` : ''}
                    <div class="spot-card-foot">
                        <span>${s.application_count || 0} postul${s.application_count === 1 ? 'ación' : 'aciones'}</span>
                        <span>${s.start_date ? formatDateRange(s.start_date, s.end_date) : 'Fechas a definir'}</span>
                    </div>
                </div>
            </article>
        `;
    }

    function wireFilters() {
        document.querySelectorAll('#spots-filter .studio-pill').forEach(p => {
            p.addEventListener('click', () => {
                activeKind = p.dataset.kind || '';
                document.querySelectorAll('#spots-filter .studio-pill').forEach(b =>
                    b.classList.toggle('is-active', b === p));
                render();
            });
        });
    }

    function wireModal() {
        document.getElementById('spot-modal-close').addEventListener('click', closeModal);
        document.getElementById('spot-modal-backdrop').addEventListener('click', e => {
            if (e.target === e.currentTarget) closeModal();
        });
    }

    function openSpotFromQuery() {
        const id = new URLSearchParams(window.location.search).get('spot');
        if (!id) return;
        const spot = spots.find(x => x.id === id);
        if (spot) openModal(spot, { syncUrl: false });
    }

    function openModal(s, options = {}) {
        const syncUrl = options.syncUrl !== false;
        const studio = s.studios || {};
        const loc = s.location || {};
        const backdrop = document.getElementById('spot-modal-backdrop');
        const kindLabel = KIND_LABELS[s.kind] || s.kind;
        if (syncUrl && window.history?.replaceState) {
            const url = new URL(window.location.href);
            url.searchParams.set('spot', s.id);
            window.history.replaceState(null, '', url);
        }

        document.getElementById('spot-modal-title').textContent = s.title;
        const studioLink = studio.slug
            ? `<a href="/studio/profile/?studio=${encodeURIComponent(studio.slug)}" target="_blank" style="color:var(--primary-red);font-weight:700;">${escapeHtml(studio.name || 'Estudio')}</a>`
            : escapeHtml(studio.name || 'Estudio');
        document.getElementById('spot-modal-studio').innerHTML =
            `Publicado por ${studioLink} · ${escapeHtml([loc.city, loc.country].filter(Boolean).join(', ') || 'Ubicación a confirmar')}`;
        document.getElementById('spot-modal-description').textContent = s.description || '(Sin descripción)';

        const kindEl = document.getElementById('spot-modal-kind');
        kindEl.textContent = kindLabel;
        kindEl.className = 'spot-card-kind kind-' + s.kind;

        const cover = s.cover_image || studio.cover_image || '';
        document.getElementById('spot-modal-cover').style.backgroundImage =
            cover ? `url('${cssEscape(cover)}')` : 'none';

        // Meta
        const meta = [];
        if (s.start_date) meta.push(['Fechas', formatDateRange(s.start_date, s.end_date)]);
        if (s.weeks_minimum) {
            meta.push(['Duración',
                s.weeks_maximum && s.weeks_maximum !== s.weeks_minimum
                    ? `${s.weeks_minimum}–${s.weeks_maximum} semanas`
                    : `${s.weeks_minimum} semanas`]);
        }
        if (s.revenue_split_pct != null) meta.push(['Split', Number(s.revenue_split_pct).toFixed(0) + '%']);
        if (s.stipend_amount) meta.push(['Stipend', `${s.stipend_amount} ${s.stipend_currency || ''}`]);
        if (s.experience_min_years) meta.push(['Experiencia mínima', `${s.experience_min_years}+ años`]);
        meta.push(['Vivienda', s.includes_housing ? 'Incluida' : 'No incluida']);
        if (s.language_requirements && s.language_requirements.length)
            meta.push(['Idiomas', s.language_requirements.join(' · ')]);
        meta.push(['Postulaciones', `${s.application_count || 0}${s.max_applications ? ' / ' + s.max_applications : ''}`]);

        document.getElementById('spot-modal-meta').innerHTML = meta.map(([k, v]) => `
            <div class="studio-meta-row">
                <span class="key">${escapeHtml(k)}</span>
                <span class="val">${escapeHtml(v)}</span>
            </div>
        `).join('');

        document.getElementById('spot-modal-styles').innerHTML =
            (s.styles_wanted || []).map(st => `<span class="studio-style-pill">${escapeHtml(st)}</span>`).join('');

        renderApplyArea(s);

        backdrop.classList.remove('hidden');
    }

    function closeModal() {
        document.getElementById('spot-modal-backdrop').classList.add('hidden');
        if (window.history?.replaceState) {
            const url = new URL(window.location.href);
            url.searchParams.delete('spot');
            window.history.replaceState(null, '', url);
        }
    }

    async function renderApplyArea(s) {
        const el = document.getElementById('spot-modal-apply');
        const { data: { session } } = await _supabase.auth.getSession();

        if (!session) {
            el.innerHTML = `
                <a class="studio-btn studio-btn-primary" href="/artist/login?returnTo=${encodeURIComponent('/studio-spots/?spot=' + s.id)}">
                    <i class="fa-solid fa-arrow-right-to-bracket"></i> Ingresá para postular
                </a>
                <p class="studio-help" style="margin-top:8px;">¿No sos artista en We Ötzi todavía? <a href="/register-artist" style="color:var(--primary-red);font-weight:700;">Registrate gratis</a>.</p>
            `;
            return;
        }

        // Already applied?
        const { data: existing } = await WeotziData.StudioSpots.getApplication(s.id, session.user.id);

        if (existing) {
            el.innerHTML = `
                <div class="studio-status studio-status-info">
                    Ya aplicaste a este spot. Estado: <strong>${escapeHtml(existing.status)}</strong>.
                </div>
            `;
            return;
        }

        // Verify the user is an artist (has artists_db row).
        const { data: artist } = await WeotziData.Artists.getByUserId(session.user.id, 'user_id, portafolio');

        if (!artist) {
            el.innerHTML = `
                <div class="studio-status studio-status-info">
                    Solo cuentas de artista pueden postular. Si querés aplicar, registrá tu perfil de artista primero.
                </div>
            `;
            return;
        }

        el.innerHTML = `
            <div class="studio-field">
                <label class="studio-label" for="apply-message">Mensaje para el estudio</label>
                <textarea id="apply-message" class="studio-textarea" rows="4" placeholder="Contales por qué encajás en este spot…"></textarea>
            </div>
            <div class="studio-field">
                <label class="studio-label" for="apply-portfolio">URL de portfolio (opcional)</label>
                <input id="apply-portfolio" class="studio-input" type="url" placeholder="https://…" value="${escapeAttr(artist.portafolio || '')}">
            </div>
            <button id="apply-submit" class="studio-btn studio-btn-primary">
                <i class="fa-solid fa-paper-plane"></i> Postularme
            </button>
            <span id="apply-status" class="studio-status studio-status-info" hidden></span>
        `;

        document.getElementById('apply-submit').addEventListener('click', async () => {
            const btn = document.getElementById('apply-submit');
            const statusEl = document.getElementById('apply-status');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Enviando…';

            const { error } = await WeotziData.StudioSpots.createApplication({
                spotId: s.id,
                artistUserId: session.user.id,
                message: (document.getElementById('apply-message').value || '').trim() || null,
                portfolioUrl: (document.getElementById('apply-portfolio').value || '').trim() || null
            });

            if (error) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Postularme';
                statusEl.className = 'studio-status studio-status-error';
                statusEl.textContent = error.message;
                statusEl.hidden = false;
                return;
            }
            statusEl.className = 'studio-status studio-status-success';
            statusEl.textContent = '¡Postulación enviada! El estudio la verá en su panel.';
            statusEl.hidden = false;
            btn.style.display = 'none';
        });
    }

    // -------- helpers --------
    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(v) { return escapeHtml(v); }
    function cssEscape(v) { return String(v).replace(/'/g, "\\'").replace(/"/g, '\\"'); }
    function formatDateRange(start, end) {
        if (!start) return '';
        const s = new Date(start);
        const sStr = s.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
        if (!end) return 'Desde ' + sStr;
        const e = new Date(end);
        const eStr = e.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
        return `${sStr} – ${eStr}`;
    }
})();
