// ============================================
// Studio Public Profile
// Reads ?studio=<slug-or-id> from the URL, renders the profile, and shows
// every studio_locations as a numbered Bauhaus pin on a Google Map.
// Roster and aggregated styles come from active memberships.
// ============================================

(function () {
    'use strict';

    const supabaseUrl = window.CONFIG?.supabase?.url || 'https://flbgmlvfiejfttlawnfu.supabase.co';
    const supabaseKey = window.CONFIG?.supabase?.anonKey
        || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsYmdtbHZmaWVqZnR0bGF3bmZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU5MTI1ODksImV4cCI6MjA2MTQ4ODU4OX0.AQm4HM8Gjci08p1vfxu6-6MbT_PRceZm5qQbwxA3888';
    if (!window._supabase) window._supabase = supabase.createClient(supabaseUrl, supabaseKey);
    const _supabase = window._supabase;

    document.addEventListener('DOMContentLoaded', async () => {
        const params = new URLSearchParams(window.location.search);
        const studioRef = params.get('studio') || params.get('id') || params.get('slug');
        if (!studioRef) {
            renderError('Falta el parámetro ?studio=<slug-o-id>.');
            return;
        }
        try {
            await renderStudioProfile(studioRef);
        } catch (err) {
            console.error('[studio-profile] failed:', err);
            renderError(err.message || 'No se pudo cargar el perfil.');
        }
    });

    function renderError(msg) {
        document.getElementById('profile-h1').textContent = 'Error';
        document.getElementById('profile-tagline').textContent = msg;
    }

    async function renderStudioProfile(ref) {
        // Resolve studio by slug OR id.
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
        const lookup = _supabase.from('studios').select('*');
        const { data: studio, error } = await (
            isUuid ? lookup.eq('id', ref).maybeSingle()
                   : lookup.eq('slug', ref).maybeSingle()
        );
        if (error) throw error;
        if (!studio) {
            renderError('Estudio no encontrado.');
            return;
        }

        // Header
        document.title = (studio.name || 'Estudio') + ' · We Ötzi';
        document.getElementById('profile-name-display').innerHTML =
            escapeHtml(studio.name || 'Estudio');
        document.getElementById('profile-h1').textContent = studio.name || 'Estudio';
        document.getElementById('profile-tagline').textContent =
            studio.tagline || (studio.bio ? '' : 'Bauhaus · Ötzi');
        document.getElementById('profile-bio').textContent =
            studio.bio || 'Este estudio aún no escribió una descripción.';

        const cover = document.getElementById('profile-cover');
        if (studio.cover_image) cover.style.backgroundImage = "url('" + cssEscape(studio.cover_image) + "')";

        // Action chips on the cover
        const actions = document.getElementById('profile-cover-actions');
        actions.innerHTML = [
            studio.instagram ? `<a class="studio-btn" target="_blank" href="${escapeAttr(igUrl(studio.instagram))}"><i class="fa-brands fa-instagram"></i></a>` : '',
            studio.website   ? `<a class="studio-btn" target="_blank" href="${escapeAttr(studio.website)}"><i class="fa-solid fa-globe"></i> Sitio</a>` : '',
            studio.whatsapp  ? `<a class="studio-btn" target="_blank" href="${escapeAttr(waUrl(studio.whatsapp))}"><i class="fa-brands fa-whatsapp"></i></a>` : ''
        ].filter(Boolean).join('');

        // Photos
        const photos = (studio.photo_feed_items || []).filter(p => p && p.url);
        const photosEl = document.getElementById('profile-photos');
        if (photos.length === 0) {
            photosEl.innerHTML = '<p class="studio-help">Sin fotos cargadas todavía.</p>';
        } else {
            photosEl.innerHTML = photos.map(p =>
                `<div class="studio-photo-tile" style="background-image:url('${cssEscape(p.url)}')"></div>`
            ).join('');
        }

        // Locations + map
        const { data: locations } = await _supabase
            .from('studio_locations')
            .select('*')
            .eq('studio_id', studio.id)
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

        renderMeta(studio, locations || []);
        await renderMap(locations || []);

        // Roster + aggregated styles via memberships → artists.
        const { data: memberships } = await _supabase
            .from('studio_artist_memberships')
            .select(`
                role, status,
                artists_db ( user_id, username, name, profile_picture, styles_array, session_price )
            `)
            .eq('studio_id', studio.id)
            .eq('status', 'active');

        renderRoster(memberships || []);
        renderAggregatedStyles(memberships || []);
        await renderSponsors(studio.id);
        renderStudioReviews(studio);
    }

    function renderStudioReviews(studio) {
        if (!studio?.id || !window.WeOtziReviews) return;
        window.WeOtziReviews.renderPublicReviews({
            mount: 'studio-reviews',
            revieweeType: 'studio',
            revieweeId: studio.id,
            title: 'Resenas del estudio'
        });
    }

    function renderMeta(studio, locations) {
        const grid = document.getElementById('profile-meta');
        const rows = [
            ['Sedes',         String(locations.length)],
            ['Fundado',       studio.founded_year ? String(studio.founded_year) : '—'],
            ['Idiomas',       (studio.languages || []).join(' · ') || '—'],
            ['Verificado',    studio.is_verified ? 'Sí' : 'No'],
            ['Ciudades',      Array.from(new Set(locations.map(l => l.city).filter(Boolean))).join(' · ') || '—'],
            ['Países',        Array.from(new Set(locations.map(l => l.country).filter(Boolean))).join(' · ') || '—']
        ];
        grid.innerHTML = rows.map(([k, v]) => `
            <div class="studio-meta-row">
                <span class="key">${escapeHtml(k)}</span>
                <span class="val">${escapeHtml(v)}</span>
            </div>
        `).join('');
    }

    function renderRoster(memberships) {
        const el = document.getElementById('profile-roster');
        if (memberships.length === 0) {
            el.innerHTML = '<p class="studio-help">Sin artistas en el roster por ahora.</p>';
            return;
        }
        el.innerHTML = memberships.map(m => {
            const a = m.artists_db || {};
            const display = a.name || a.username || '—';
            const pic = a.profile_picture
                ? `<div class="pic" style="background-image:url('${cssEscape(a.profile_picture)}')"></div>`
                : '<div class="pic"></div>';
            return `
                <a class="studio-roster-card" href="/artist/profile?artist=${encodeURIComponent(a.username || '')}" rel="noopener">
                    ${pic}
                    <div class="body">
                        <strong>${escapeHtml(display)}</strong>
                        <span class="role">${escapeHtml(m.role)}</span>
                    </div>
                </a>
            `;
        }).join('');
    }

    function renderAggregatedStyles(memberships) {
        const el = document.getElementById('profile-styles');
        const set = new Set();
        memberships.forEach(m => {
            const styles = (m.artists_db && m.artists_db.styles_array) || [];
            styles.forEach(s => s && set.add(s));
        });
        if (set.size === 0) {
            el.innerHTML = '<p class="studio-help">Aún no hay estilos asociados al estudio.</p>';
            return;
        }
        el.innerHTML = Array.from(set).slice(0, 30).map(s =>
            `<span class="studio-style-pill">${escapeHtml(s)}</span>`
        ).join('');
    }

    async function renderSponsors(studioId) {
        const section = document.getElementById('profile-sponsors-section');
        const el = document.getElementById('profile-sponsors');
        if (!section || !el) return;

        const { data: sponsors, error } = await _supabase
            .from('studio_public_sponsors_view')
            .select('id, studio_id, name, tier, logo_url, website, ends_on')
            .eq('studio_id', studioId)
            .order('tier', { ascending: false });

        if (error || !sponsors || sponsors.length === 0) {
            section.hidden = true;
            el.innerHTML = '';
            return;
        }

        const { data: links } = await _supabase
            .from('studio_sponsor_artists')
            .select('sponsor_id, artist_user_id, artists_db ( user_id, username, name )')
            .in('sponsor_id', sponsors.map(s => s.id));
        const artistsBySponsor = new Map();
        (links || []).forEach(link => {
            const a = link.artists_db || {};
            const list = artistsBySponsor.get(link.sponsor_id) || [];
            list.push(a.name || a.username || link.artist_user_id);
            artistsBySponsor.set(link.sponsor_id, list);
        });

        section.hidden = false;
        el.innerHTML = sponsors.map(sp => {
            const artists = artistsBySponsor.get(sp.id) || [];
            const logo = sp.logo_url
                ? `<div class="studio-sponsor-logo" style="background-image:url('${cssEscape(sp.logo_url)}')"></div>`
                : '<div class="studio-sponsor-logo is-empty"></div>';
            const body = `
                ${logo}
                <div class="studio-sponsor-body">
                    <span class="studio-role-pill">${escapeHtml(sp.tier || 'sponsor')}</span>
                    <strong>${escapeHtml(sp.name)}</strong>
                    ${artists.length ? `<small>${artists.slice(0, 3).map(escapeHtml).join(' · ')}</small>` : ''}
                </div>
            `;
            return sp.website
                ? `<a class="studio-sponsor-card" href="${escapeAttr(sp.website)}" target="_blank" rel="noopener">${body}</a>`
                : `<div class="studio-sponsor-card">${body}</div>`;
        }).join('');
    }

    async function renderMap(locations) {
        const mapEl = document.getElementById('studio-map');
        if (!mapEl) return;

        try {
            await window.WeOtziGeocoder.ensureGoogleMapsLoaded({ libraries: ['places'] });
        } catch (err) {
            mapEl.innerHTML = '<div style="padding:24px;font-family:var(--studio-mono);font-size:.8rem;text-align:center;">Mapa no disponible</div>';
            return;
        }

        const pinned = locations.filter(l => Number.isFinite(Number(l.latitude)) && Number.isFinite(Number(l.longitude)));
        if (pinned.length === 0) {
            mapEl.innerHTML = '<div style="padding:24px;font-family:var(--studio-mono);font-size:.8rem;text-align:center;">Sin sedes geolocalizadas.</div>';
            return;
        }

        const isDark = document.body.getAttribute('data-theme') === 'dark';
        const styles = [
            { elementType: 'geometry', stylers: [{ color: isDark ? '#141414' : '#f0ede4' }] },
            { elementType: 'labels.text.stroke', stylers: [{ color: isDark ? '#141414' : '#f0ede4' }] },
            { elementType: 'labels.text.fill', stylers: [{ color: isDark ? '#7a7a7a' : '#5c5c5c' }] },
            { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: isDark ? '#F2F0E9' : '#0A0A0A' }, { weight: 1 }] },
            { featureType: 'water', elementType: 'geometry', stylers: [{ color: isDark ? '#0A0A0A' : '#dcd8cb' }] },
            { featureType: 'road', stylers: [{ visibility: 'simplified' }] },
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', stylers: [{ visibility: 'off' }] }
        ];

        const map = new google.maps.Map(mapEl, {
            center: { lat: Number(pinned[0].latitude), lng: Number(pinned[0].longitude) },
            zoom: pinned.length === 1 ? 13 : 4,
            disableDefaultUI: true,
            zoomControl: true,
            styles,
            backgroundColor: isDark ? '#0A0A0A' : '#f0ede4'
        });

        function PinOverlay(position, html) {
            this.position = position; this.html = html; this.div = null;
        }
        PinOverlay.prototype = new google.maps.OverlayView();
        PinOverlay.prototype.onAdd = function () {
            const div = document.createElement('div');
            div.className = 'bauhaus-pin-wrap';
            div.innerHTML = this.html;
            this.div = div;
            const panes = this.getPanes();
            (panes && panes.overlayMouseTarget || panes.floatPane).appendChild(div);
        };
        PinOverlay.prototype.draw = function () {
            if (!this.div) return;
            const proj = this.getProjection();
            if (!proj) return;
            const p = proj.fromLatLngToDivPixel(this.position);
            if (!p) return;
            this.div.style.left = p.x + 'px';
            this.div.style.top  = p.y + 'px';
        };
        PinOverlay.prototype.onRemove = function () {
            if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
            this.div = null;
        };

        const bounds = new google.maps.LatLngBounds();
        pinned.forEach((loc, i) => {
            const lat = Number(loc.latitude), lng = Number(loc.longitude);
            const overlay = new PinOverlay(
                new google.maps.LatLng(lat, lng),
                `<div class="bauhaus-pin" title="${escapeAttr(loc.formatted_address || '')}">№ ${(i + 1).toString().padStart(2, '0')}${loc.is_primary ? ' ★' : ''}</div>`
            );
            overlay.setMap(map);
            bounds.extend({ lat, lng });
        });

        if (pinned.length > 1) {
            map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
            google.maps.event.addListenerOnce(map, 'idle', () => {
                if (map.getZoom() > 12) map.setZoom(12);
            });
        }
    }

    // -------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------
    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(v) { return escapeHtml(v); }
    function cssEscape(v)  { return String(v).replace(/'/g, "\\'").replace(/"/g, '\\"'); }
    function igUrl(handle) {
        const h = String(handle || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '');
        return 'https://instagram.com/' + h;
    }
    function waUrl(num) {
        const digits = String(num || '').replace(/[^\d]/g, '');
        return 'https://wa.me/' + digits;
    }
})();
