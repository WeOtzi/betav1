// ============================================
// Public Spots Directory (DS Bauhaus)
// Lists all `studio_spots` with status='open', filterable by kind.
// Primer spot → tarjeta destacada; el resto → mosaico editorial.
// Click en cualquier tarjeta → modal con detalle + CTA de postulación.
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
    const URGENT_DAYS = 7;
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
                '<div class="wo-alert wo-alert--error">No pudimos cargar los spots: ' + escapeHtml(error.message) + '</div>';
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
            grid.innerHTML = `
                <div class="wo-empty" style="grid-column:1/-1;">
                    <i data-wo-icon="inbox" aria-hidden="true"></i>
                    <span class="wo-empty-title">No hay spots abiertos en esta categoría</span>
                    <p>Volvé más tarde o probá con otro tipo de spot.</p>
                </div>
            `;
            return;
        }
        const [first, ...rest] = filtered;
        grid.innerHTML = renderHero(first) + rest.map((s, i) => renderTile(s, i)).join('');
        grid.querySelectorAll('[data-id]').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                const spot = spots.find(x => x.id === id);
                if (spot) openModal(spot);
            });
        });
    }

    // ---- helpers de contenido ----

    function spotName(s) {
        const studio = s.studios || {};
        return studio.name || s.title || 'Estudio';
    }

    function durationText(s) {
        if (s.weeks_minimum) {
            const w = s.weeks_maximum && s.weeks_maximum !== s.weeks_minimum
                ? `${s.weeks_minimum}–${s.weeks_maximum} semanas`
                : `${s.weeks_minimum} semana${s.weeks_minimum === 1 ? '' : 's'}`;
            return w;
        }
        if (s.start_date) return formatDateRange(s.start_date, s.end_date);
        return '';
    }

    function metaLine(s) {
        const parts = [];
        const dur = durationText(s);
        if (dur) parts.push(dur);
        if (s.revenue_split_pct != null) parts.push(`Split ${Number(s.revenue_split_pct).toFixed(0)}%`);
        if (s.stipend_amount) parts.push(`Stipend ${s.stipend_amount} ${s.stipend_currency || ''}`.trim());
        return parts.join(' · ');
    }

    function daysToClose(s) {
        if (!s.expires_at) return null;
        const diff = new Date(s.expires_at) - Date.now();
        if (diff <= 0) return 0;
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    function markHtml(kind) {
        return `<span class="sps-mark sps-mark--${escapeAttr(kind)}" aria-hidden="true"></span>`;
    }

    // ---- tarjeta destacada ----

    function renderHero(s) {
        const studio = s.studios || {};
        const loc = s.location || {};
        const cover = s.cover_image || studio.cover_image || '';
        const city = loc.city || 'Ubicación a confirmar';
        const stylesTags = (s.styles_wanted || []).slice(0, 4).map(st =>
            `<span class="sps-tag">${escapeHtml(st)}</span>`
        ).join('');
        const desc = [s.title, s.description].filter(Boolean).join(' — ');

        return `
            <article class="sps-hero" data-id="${escapeAttr(s.id)}">
                <div class="sps-hero-media" ${cover ? `style="background-image:url('${cssEscape(cover)}')"` : ''}></div>
                <div class="sps-hero-body">
                    <span class="sps-hero-eyebrow">${markHtml(s.kind)} ${escapeHtml(KIND_LABELS[s.kind] || s.kind)} · ${escapeHtml(city)}</span>
                    <h2 class="sps-hero-title">${escapeHtml(spotName(s))}</h2>
                    ${metaLine(s) ? `<span class="sps-hero-meta wo-mono-num">${escapeHtml(metaLine(s))}</span>` : ''}
                    ${stylesTags ? `<div class="sps-styles">${stylesTags}</div>` : ''}
                    ${desc ? `<p class="sps-hero-desc">${escapeHtml(truncate(desc, 180))}</p>` : ''}
                    <div class="sps-hero-actions">
                        <button type="button" class="wo-btn wo-btn--direct wo-btn--hard">
                            Postularme <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="wo-btn wo-btn--ghost">Ver detalles</button>
                    </div>
                </div>
            </article>
        `;
    }

    // ---- tiles del mosaico ----

    function renderTile(s, index) {
        const loc = s.location || {};
        const city = loc.city || 'Ubicación a confirmar';
        const close = daysToClose(s);
        const urgent = close !== null && close <= URGENT_DAYS;
        const variant = urgent ? 'sps-tile--urgent' : (index % 2 === 1 ? 'sps-tile--cream' : '');

        return `
            <article class="sps-tile ${variant}" data-id="${escapeAttr(s.id)}">
                ${urgent ? `<span class="sps-tile-urgency">Última oportunidad · cierra en ${close === 0 ? 'horas' : close + ' día' + (close === 1 ? '' : 's')}</span>` : ''}
                <span class="sps-tile-top">${markHtml(s.kind)}<span class="sps-tile-city">${escapeHtml(city)}</span></span>
                <h3 class="sps-tile-name">${escapeHtml(spotName(s))}</h3>
                ${metaLine(s) ? `<span class="sps-tile-meta wo-mono-num">${escapeHtml(metaLine(s))}</span>` : ''}
            </article>
        `;
    }

    function wireFilters() {
        document.querySelectorAll('#spots-filter [data-kind]').forEach(p => {
            p.addEventListener('click', () => {
                activeKind = p.dataset.kind || '';
                document.querySelectorAll('#spots-filter [data-kind]').forEach(b =>
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
            ? `<a href="/studio/profile/?studio=${encodeURIComponent(studio.slug)}" target="_blank">${escapeHtml(studio.name || 'Estudio')}</a>`
            : escapeHtml(studio.name || 'Estudio');
        document.getElementById('spot-modal-studio').innerHTML =
            `Publicado por ${studioLink} · ${escapeHtml([loc.city, loc.country].filter(Boolean).join(', ') || 'Ubicación a confirmar')}`;
        document.getElementById('spot-modal-description').textContent = s.description || '(Sin descripción)';

        const kindEl = document.getElementById('spot-modal-kind');
        kindEl.textContent = kindLabel;
        kindEl.className = 'wo-badge wo-badge--s sps-kind sps-kind--' + s.kind;

        const cover = s.cover_image || studio.cover_image || '';
        document.getElementById('spot-modal-cover').style.backgroundImage =
            cover ? `url('${cssEscape(cover)}')` : 'none';

        // Meta
        const meta = [];
        if (s.start_date) meta.push(['Fechas disponibles', formatDateRange(s.start_date, s.end_date)]);
        if (s.weeks_minimum) {
            meta.push(['Duración',
                s.weeks_maximum && s.weeks_maximum !== s.weeks_minimum
                    ? `${s.weeks_minimum}–${s.weeks_maximum} semanas`
                    : `${s.weeks_minimum} semanas`]);
        }
        if (s.revenue_split_pct != null) meta.push(['Split / comisión', Number(s.revenue_split_pct).toFixed(0) + '% para el artista']);
        if (s.stipend_amount) meta.push(['Stipend', `${s.stipend_amount} ${s.stipend_currency || ''}`]);
        if (s.experience_min_years) meta.push(['Experiencia mínima', `${s.experience_min_years}+ años`]);
        meta.push(['Vivienda', s.includes_housing ? 'Incluida' : 'No incluida']);
        if (s.language_requirements && s.language_requirements.length)
            meta.push(['Idiomas', s.language_requirements.join(' · ')]);
        meta.push(['Postulaciones', `${s.application_count || 0}${s.max_applications ? ' / ' + s.max_applications : ''}`]);

        document.getElementById('spot-modal-meta').innerHTML = meta.map(([k, v]) => `
            <div class="sps-meta-row">
                <span class="sps-meta-key">${escapeHtml(k)}</span>
                <span class="sps-meta-val">${escapeHtml(v)}</span>
            </div>
        `).join('');

        document.getElementById('spot-modal-styles').innerHTML =
            (s.styles_wanted || []).map(st => `<span class="sps-tag">${escapeHtml(st)}</span>`).join('');

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
                <a class="wo-btn wo-btn--direct wo-btn--block wo-btn--hard" href="/artist/login?returnTo=${encodeURIComponent('/studio-spots/?spot=' + s.id)}">
                    Ingresá para postular <i data-wo-icon="arrow-right" class="wo-icon-18" aria-hidden="true"></i>
                </a>
                <p class="sps-apply-help">¿Todavía no sos artista en We Ötzi? <a href="/register-artist">Registrate gratis</a>.</p>
            `;
            return;
        }

        // Already applied?
        const { data: existing } = await WeotziData.StudioSpots.getApplication(s.id, session.user.id);

        if (existing) {
            el.innerHTML = `
                <div class="wo-alert wo-alert--info">
                    Ya te postulaste a este spot. Estado: <strong>${escapeHtml(existing.status)}</strong>.
                </div>
            `;
            return;
        }

        // Verify the user is an artist (has artists_db row).
        const { data: artist } = await WeotziData.Artists.getByUserId(session.user.id, 'user_id, portafolio');

        if (!artist) {
            el.innerHTML = `
                <div class="wo-alert wo-alert--info">
                    Solo cuentas de artista pueden postular. Si querés aplicar, registrá tu perfil de artista primero.
                </div>
            `;
            return;
        }

        el.innerHTML = `
            <div class="wo-field">
                <label class="wo-label" for="apply-message">Mensaje de presentación</label>
                <textarea id="apply-message" class="wo-textarea" rows="4" placeholder="Contale al estudio por qué te gustaría hacer este spot…"></textarea>
            </div>
            <div class="wo-field">
                <label class="wo-label" for="apply-portfolio">Portfolio (opcional)</label>
                <input id="apply-portfolio" class="wo-input" type="url" placeholder="https://…" value="${escapeAttr(artist.portafolio || '')}">
            </div>
            <button id="apply-submit" class="wo-btn wo-btn--direct wo-btn--block wo-btn--hard">
                Enviar solicitud <i data-wo-icon="send" class="wo-icon-18" aria-hidden="true"></i>
            </button>
            <div id="apply-status" class="wo-alert wo-alert--info" hidden></div>
        `;

        document.getElementById('apply-submit').addEventListener('click', async () => {
            const btn = document.getElementById('apply-submit');
            const statusEl = document.getElementById('apply-status');
            btn.disabled = true;
            btn.textContent = 'Enviando…';

            const { error } = await WeotziData.StudioSpots.createApplication({
                spotId: s.id,
                artistUserId: session.user.id,
                message: (document.getElementById('apply-message').value || '').trim() || null,
                portfolioUrl: (document.getElementById('apply-portfolio').value || '').trim() || null
            });

            if (error) {
                btn.disabled = false;
                btn.innerHTML = 'Enviar solicitud <i data-wo-icon="send" class="wo-icon-18" aria-hidden="true"></i>';
                statusEl.className = 'wo-alert wo-alert--error';
                statusEl.textContent = error.message;
                statusEl.hidden = false;
                return;
            }
            statusEl.className = 'wo-alert wo-alert--success';
            statusEl.textContent = 'Solicitud enviada. El estudio la va a ver en su panel y te contesta por acá.';
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
    function truncate(text, maxLen) {
        const t = String(text || '');
        if (t.length <= maxLen) return t;
        return t.substring(0, maxLen).trimEnd() + '…';
    }
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
