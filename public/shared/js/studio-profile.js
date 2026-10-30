// ============================================
// Studio Public Profile
// Reads ?studio=<slug-or-id> from the URL, renders the profile, and shows
// every studio_locations as a numbered Bauhaus pin on a Google Map.
// Roster and aggregated styles come from active memberships
// (StudioMemberships.listActiveRosterWithArtists → vista studio_public_roster,
// con fallback a la tabla): "Residentes" y "Guest e itinerantes", con
// "Hasta {ends_on}" del contrato firmado para los guests.
// "Spots abiertos" sale de StudioSpots.listOpenByStudio; #studio-store queda
// como hueco vacío para la vitrina de la Tienda (fase Store).
// Contrato: docs/plans/2026-10-30-estudios-plataforma.md → "Perfil público".
// ============================================

(function () {
    'use strict';

    // Roles de studio_artist_memberships y tipos de studio_spots, en español.
    const ROLE_LABELS = { resident: 'Residente', guest: 'Guest', itinerant: 'Itinerante', manager: 'Manager' };
    const GUEST_ROLES = ['guest', 'itinerant'];
    const SPOT_KIND_LABELS = { resident: 'Residencia', guest_spot: 'Guest spot', itinerant: 'Itinerante' };
    const SPOT_KIND_PILL = { resident: 'role-resident', guest_spot: 'role-guest', itinerant: 'role-itinerant' };
    const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    document.addEventListener('DOMContentLoaded', async () => {
        const params = new URLSearchParams(window.location.search);
        const studioRef = params.get('studio') || params.get('id') || params.get('slug');
        if (!studioRef) {
            renderError('Falta el parámetro ?studio=<slug-o-id>.');
            return;
        }
        try {
            await window.ConfigManager?.ready?.();
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
        const { data: studio, error } = await (
            isUuid ? WeotziData.Studios.getById(ref)
                   : WeotziData.Studios.getBySlug(ref)
        );
        if (error) throw error;
        if (!studio || studio.is_active === false) {
            renderError('Estudio no encontrado.');
            return;
        }

        // Header
        document.title = (studio.name || 'Estudio') + ' · We Ötzi';
        document.getElementById('profile-name-display').innerHTML =
            escapeHtml(studio.name || 'Estudio');
        document.getElementById('profile-h1').textContent = studio.name || 'Estudio';
        document.getElementById('profile-tagline').textContent =
            studio.tagline || (studio.bio ? '' : 'Estudio de tatuajes');
        document.getElementById('profile-bio').textContent =
            studio.bio || 'Este estudio aún no escribió una descripción.';

        const cover = document.getElementById('profile-cover');
        if (safeUrl(studio.cover_image)) cover.style.backgroundImage = "url(" + JSON.stringify(safeUrl(studio.cover_image)) + ")";

        // Action chips on the cover
        const actions = document.getElementById('profile-cover-actions');
        actions.innerHTML = [
            studio.instagram ? `<a class="studio-btn" target="_blank" href="${escapeAttr(igUrl(studio.instagram))}"><i class="fa-brands fa-instagram"></i></a>` : '',
            safeUrl(studio.website) ? `<a class="studio-btn" target="_blank" rel="noopener noreferrer" href="${escapeAttr(safeUrl(studio.website))}"><i class="fa-solid fa-globe"></i> Sitio</a>` : '',
            studio.whatsapp  ? `<a class="studio-btn" target="_blank" href="${escapeAttr(waUrl(studio.whatsapp))}"><i class="fa-brands fa-whatsapp"></i></a>` : ''
        ].filter(Boolean).join('');

        // Photos
        const photos = (Array.isArray(studio.photo_feed_items) ? studio.photo_feed_items : []).filter(p => safeUrl(p?.url));
        const photosEl = document.getElementById('profile-photos');
        if (photos.length === 0) {
            photosEl.innerHTML = '<p class="studio-help">Sin fotos cargadas todavía.</p>';
        } else {
            photosEl.innerHTML = photos.map(p =>
                `<div class="studio-photo-tile" style="background-image:url('${cssEscape(p.url)}')"></div>`
            ).join('');
        }

        // Locations + map
        const { data: locations, error: locationError } = await WeotziData.StudioLocations.listActiveByStudio(studio.id);
        if (locationError) throw locationError;

        renderMeta(studio, locations || []);
        renderLocations(locations || []);
        // El mapa (Google Maps) no frena el resto del perfil.
        const mapReady = renderMap(locations || []).catch(err => console.warn('[studio-profile] map:', err));

        prepareStoreSlot(studio);

        // Roster + aggregated styles via memberships → artists. Si el roster
        // falla, el resto del perfil se muestra igual.
        const memberships = await loadRoster(studio.id);
        renderRoster(memberships);
        renderAggregatedStyles(memberships || []);
        await renderOpenSpots(studio.id);
        await renderSponsors(studio.id);
        renderStudioReviews(studio);
        await mapReady;
    }

    async function loadRoster(studioId) {
        try {
            const { data, error } = await WeotziData.StudioMemberships.listActiveRosterWithArtists(studioId);
            if (error) throw error;
            return data || [];
        } catch (err) {
            console.warn('[studio-profile] roster:', err);
            return null;
        }
    }

    // Hueco para la vitrina de la Tienda: queda vacío y oculto; el módulo de
    // Store lo completa leyendo data-studio-id / data-studio-slug.
    function prepareStoreSlot(studio) {
        const slot = document.getElementById('studio-store');
        if (!slot || !studio) return;
        slot.setAttribute('data-studio-id', studio.id || '');
        slot.setAttribute('data-studio-slug', studio.slug || '');
        renderStudioStore(slot, studio);
    }

    // Vitrina de la Tienda del estudio (get_public_storefront 'studio', M6).
    // Sin Store o sin productos publicados, la sección queda oculta.
    async function renderStudioStore(slot, studio) {
        const store = window.WeotziData && window.WeotziData.Store;
        const model = window.WeotziStoreModel;
        if (!store || typeof store.getStorefront !== 'function' || !studio.slug) return;
        let front = null;
        try { front = await store.getStorefront('studio', studio.slug); } catch (_) { return; }
        const products = (front && Array.isArray(front.products) ? front.products : []).filter(p => p && p.kind === 'merch');
        if (!products.length) return;
        const money = (amount, currency) => model && typeof model.formatMoney === 'function'
            ? model.formatMoney(amount, currency) : `${currency || ''} ${amount}`;
        const itemHref = id => model && typeof model.itemUrl === 'function' ? model.itemUrl(id) : `/store/item/?id=${encodeURIComponent(id)}`;
        const cards = products.map(p => {
            const img = Array.isArray(p.images) && p.images[0] && typeof store.previewUrl === 'function' ? safeUrl(store.previewUrl(p.images[0].path)) : null;
            const price = p.price_amount != null ? p.price_amount : p.price_from;
            return `<a class="studio-store-card" href="${escapeAttr(itemHref(p.id))}">`
                + (img ? `<img src="${escapeAttr(img)}" alt="${escapeAttr((p.images[0] && p.images[0].alt) || p.title)}" loading="lazy">` : '<span class="studio-store-card__ph" aria-hidden="true"></span>')
                + `<strong>${escapeHtml(p.title)}</strong>`
                + (price != null ? `<span>${escapeHtml(money(price, p.currency))}</span>` : '')
                + '</a>';
        }).join('');
        slot.innerHTML = '<div class="studio-section-kicker">Tienda</div>'
            + '<h2 class="studio-section-title">Merch y <em>cuidado</em></h2>'
            + `<div class="studio-store-grid">${cards}</div>`;
        slot.hidden = false;
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
        if (!el) return;
        el.innerHTML = memberships == null
            ? '<p class="studio-help">No pudimos cargar el roster. Probá de nuevo en un rato.</p>'
            : rosterHtml(groupRoster(memberships));
    }

    // Residentes (y managers) por un lado; guests e itinerantes por otro,
    // ordenados por el fin de su contrato (los sin fecha, al final).
    function groupRoster(memberships) {
        const residents = [];
        const guests = [];
        (Array.isArray(memberships) ? memberships : []).forEach(m => {
            if (!m) return;
            (GUEST_ROLES.includes(m.role) ? guests : residents).push(m);
        });
        const byName = (a, b) => artistName(a).localeCompare(artistName(b), 'es');
        const roleRank = m => (m.role === 'manager' ? 1 : 0);
        const endKey = m => (isIsoDate(m.ends_on) ? String(m.ends_on).slice(0, 10) : '9999-12-31');
        residents.sort((a, b) => roleRank(a) - roleRank(b) || byName(a, b));
        guests.sort((a, b) => endKey(a).localeCompare(endKey(b)) || byName(a, b));
        return { residents, guests };
    }

    function rosterHtml(groups) {
        const residents = (groups && groups.residents) || [];
        const guests = (groups && groups.guests) || [];
        if (residents.length === 0 && guests.length === 0) {
            return '<p class="studio-help">Sin artistas en el roster por ahora.</p>';
        }
        const group = (key, title, list, opts) => list.length === 0 ? '' : `
            <section class="studio-profile-roster-group" data-roster-group="${key}">
                <h3 class="studio-label studio-profile-roster-title">${escapeHtml(title)} <span class="count">· ${list.length}</span></h3>
                <div class="studio-roster-cards">${list.map(m => rosterCardHtml(m, opts)).join('')}</div>
            </section>
        `;
        return group('residents', 'Residentes', residents, { showEndsOn: false })
            + group('guests', 'Guest e itinerantes', guests, { showEndsOn: true });
    }

    function rosterCardHtml(m, opts) {
        const a = (m && m.artists_db) || {};
        const pic = safeUrl(a.profile_picture)
            ? `<div class="pic" style="background-image:url('${cssEscape(a.profile_picture)}')"></div>`
            : '<div class="pic"></div>';
        const until = opts && opts.showEndsOn && isIsoDate(m.ends_on)
            ? `<span class="until">${escapeHtml(endsOnLabel(m.ends_on))}</span>`
            : '';
        const body = `
                    ${pic}
                    <div class="body">
                        <strong>${escapeHtml(artistName(m))}</strong>
                        <span class="role">${escapeHtml(roleLabel(m.role))}</span>
                        ${until}
                    </div>`;
        return a.username
            ? `<a class="studio-roster-card" href="/artist/profile?artist=${encodeURIComponent(a.username)}">${body}</a>`
            : `<div class="studio-roster-card">${body}</div>`;
    }

    function artistName(m) {
        const a = (m && m.artists_db) || {};
        return a.name || a.username || 'Artista';
    }
    function roleLabel(role) {
        return ROLE_LABELS[role] || 'Artista';
    }
    function endsOnLabel(endsOn) {
        return 'Hasta ' + formatDate(endsOn, 'long');
    }

    // ---- Spots abiertos ----

    async function renderOpenSpots(studioId) {
        const section = document.getElementById('profile-spots-section');
        const el = document.getElementById('profile-spots');
        if (!section || !el) return;
        let rows = [];
        const repo = window.WeotziData && window.WeotziData.StudioSpots;
        if (repo && typeof repo.listOpenByStudio === 'function') {
            try {
                const { data, error } = await repo.listOpenByStudio(studioId);
                if (error) console.warn('[studio-profile] spots abiertos:', error);
                else rows = Array.isArray(data) ? data : [];
            } catch (err) {
                console.warn('[studio-profile] spots abiertos:', err);
            }
        }
        section.hidden = rows.length === 0;
        el.innerHTML = rows.length ? spotsHtml(rows) : '';
    }

    function spotsHtml(spots) {
        return (Array.isArray(spots) ? spots : []).filter(s => s && s.id).map(spotCardHtml).join('');
    }

    function spotCardHtml(s) {
        const benefits = normalizeList(s.benefit_tags).map(t => String(t).trim()).filter(Boolean).slice(0, 6);
        const count = Number(s.application_count) || 0;
        const applications = count > 0
            ? `${count} postulaci${count === 1 ? 'ón' : 'ones'}`
            : 'Postulaciones abiertas';
        return `
            <a class="spot-card studio-profile-spot" href="/studio-spots?spot=${encodeURIComponent(s.id)}">
                <div class="spot-card-body">
                    <span class="studio-role-pill ${SPOT_KIND_PILL[s.kind] || 'role-guest'}">${escapeHtml(SPOT_KIND_LABELS[s.kind] || 'Spot')}</span>
                    <strong class="spot-card-title">${escapeHtml(s.title || 'Spot')}</strong>
                    <span class="spot-card-meta">${escapeHtml(spotDatesText(s))}</span>
                    ${benefits.length ? `<div class="spot-card-styles" aria-label="Beneficios">${benefits.map(b => `<span class="studio-style-pill">${escapeHtml(b)}</span>`).join('')}</div>` : ''}
                    <div class="spot-card-foot">
                        <span>${escapeHtml(applications)}</span>
                        <span>Ver spot <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span>
                    </div>
                </div>
            </a>
        `;
    }

    function spotDatesText(s) {
        const start = isIsoDate(s.start_date) ? formatDate(s.start_date) : '';
        const end = isIsoDate(s.end_date) ? formatDate(s.end_date) : '';
        if (start && end) return `Del ${start} al ${end}`;
        if (start) return `Desde el ${start}`;
        if (end) return `Hasta el ${end}`;
        return 'Fechas a convenir';
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

        const { data: sponsors, error } = await WeotziData.StudioOps.listPublicSponsors(studioId);

        if (error || !sponsors || sponsors.length === 0) {
            section.hidden = true;
            el.innerHTML = '';
            return;
        }

        const { data: links } = await WeotziData.StudioOps.listSponsorArtistsBySponsorIds(sponsors.map(s => s.id));
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
            return safeUrl(sp.website)
                ? `<a class="studio-sponsor-card" href="${escapeAttr(safeUrl(sp.website))}" target="_blank" rel="noopener">${body}</a>`
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

        const pinned = locations.filter(l => l.latitude != null && l.longitude != null
            && Number.isFinite(Number(l.latitude)) && Number.isFinite(Number(l.longitude)));
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
    // URL de datos solo si es http(s) (WeOtziStudioKit.safeUrl cuando está
    // cargado); si no, ''.
    function safeUrl(value) {
        const kit = window.WeOtziStudioKit;
        if (kit && typeof kit.safeUrl === 'function') return kit.safeUrl(value) || '';
        try {
            const url = new URL(String(value || ''));
            return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
        } catch { return ''; }
    }
    function isIsoDate(value) {
        return /^\d{4}-\d{2}-\d{2}/.test(String(value || ''));
    }
    // Fechas SQL 'YYYY-MM-DD' de calendario (no instantes UTC):
    // '15/12/2026' o, con style 'long', '15 de diciembre de 2026'.
    function formatDate(value, style) {
        const kit = window.WeOtziStudioKit;
        if (kit && typeof kit.fmtDate === 'function') return kit.fmtDate(String(value).slice(0, 10), style ? { style } : undefined);
        const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
        if (!y || !m || !d) return '—';
        if (style === 'long') return `${d} de ${MONTHS[m - 1]} de ${y}`;
        return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
    function normalizeList(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string' && value.trim()) {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) return parsed;
            } catch { /* lista separada por comas */ }
            return value.split(',');
        }
        return [];
    }
    function cssEscape(value) {
        return escapeAttr(safeUrl(value).replace(/'/g, '%27').replace(/"/g, '%22').replace(/\\/g, '%5C'));
    }
    function renderLocations(locations) {
        const mount = document.getElementById('profile-locations');
        if (!mount) return;
        mount.innerHTML = locations.map(location => {
            const address = location.formatted_address || '';
            const query = [address, ...[location.city, location.country].filter(value => value
                && !address.toLocaleLowerCase().includes(value.toLocaleLowerCase()))].filter(Boolean).join(', ');
            const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
            return `<article class="studio-location-row">
                <strong>${escapeHtml(location.label || 'Sede')}${location.is_primary && !/principal/i.test(location.label || '') ? ' · Principal' : ''}</strong>
                <p class="studio-help">${escapeHtml(query)}</p>
                ${location.phone ? `<p class="studio-help">Teléfono: ${escapeHtml(location.phone)}</p>` : ''}
                ${location.hours_json?.description ? `<p class="studio-help">${escapeHtml(location.hours_json.description)}</p>` : ''}
                <a href="${escapeAttr(mapUrl)}" target="_blank" rel="noopener noreferrer" class="studio-help">Cómo llegar</a>
            </article>`;
        }).join('') || '<p class="studio-help">Todavía no hay sedes publicadas.</p>';
    }
    function igUrl(handle) {
        const h = String(handle || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '');
        return 'https://instagram.com/' + h;
    }
    function waUrl(num) {
        const digits = String(num || '').replace(/[^\d]/g, '');
        return 'https://wa.me/' + digits;
    }
})();
