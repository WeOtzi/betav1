// ============================================
// Perfil público del estudio · /studio/profile?studio=<slug-o-id>
// Figma de estudios 91wYIpURj0xn0kzqhybOOt:
//   E-PROFILE-02 (2012:305)      equipo con filtros, banda, accesos
//   E-CODE-PUBLIC-01 (2022:5625) Conocé el estudio
//   E-CODE-PUBLIC-02 (2022:5626) Encontranos · mapa de sedes (2029:9422)
//   E-CODE-PUBLIC-03 (2022:5627) El espacio (galería)
//   E-CODE-PUBLIC-04 (2022:5628) Marcas que acompañan
//   E-CODE-PUBLIC-05 (2022:5629) No encontramos este estudio
//   E-CODE-PUBLIC-06 (2022:5630) El estudio está preparando su perfil
// Sello "Estudio verificado" cuando studios.is_verified (verificación de
// estudios, lib/routes/verif-estudio.js).
// Datos por WeotziData (Studios, StudioLocations, StudioMemberships,
// StudioOps); reseñas con WeOtziReviews.
// ============================================

(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && window && window.document) {
        window.WeOtziStudioProfile = api;
        window.document.addEventListener('DOMContentLoaded', api.boot);
    }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    // Columnas públicas del estudio (sin email, teléfonos internos ni user_id).
    const STUDIO_PUBLIC_COLUMNS = 'id,slug,name,tagline,bio,cover_image,logo_image,photo_feed_items,founded_year,'
        + 'languages,instagram,tiktok,whatsapp,website,is_verified,verified_at,is_active,profile_complete,city,country,'
        + 'specialty_styles,accepts_guest_spots,is_seeking_artists';
    const ROLE_LABELS = {
        resident: 'Residente', itinerant: 'Itinerante', guest: 'Invitado', manager: 'Manager', owner: 'Dueño'
    };
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // ---------------------------------------------------------------
    // Helpers puros
    // ---------------------------------------------------------------
    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function safeUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
        } catch (_) { return ''; }
    }
    function igUrl(handle) {
        const h = String(handle || '').trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '');
        return /^[A-Za-z0-9._]{1,30}$/.test(h) ? 'https://www.instagram.com/' + h + '/' : '';
    }
    function waUrl(num) {
        const digits = String(num || '').replace(/[^\d]/g, '');
        return digits.length >= 6 ? 'https://wa.me/' + digits : '';
    }
    function initial(name) {
        const s = String(name || '').trim().replace(/^(estudio|studio)\s+/i, '');
        return (s[0] || 'E').toUpperCase();
    }
    function roleLabel(role) {
        return ROLE_LABELS[role] || (role ? String(role) : 'Artista');
    }
    function locationLine(loc) {
        const address = (loc && loc.formatted_address) || '';
        const extras = [loc && loc.city, loc && loc.country].filter(v => v && !address.toLocaleLowerCase().includes(String(v).toLocaleLowerCase()));
        return [address].concat(extras).filter(Boolean).join(', ');
    }
    function primaryLocation(locations) {
        const list = Array.isArray(locations) ? locations : [];
        return list.find(l => l.is_primary) || list[0] || null;
    }
    function aggregatedStyles(memberships, studio) {
        const set = new Set();
        (Array.isArray(memberships) ? memberships : []).forEach(m => {
            ((m.artists_db && m.artists_db.styles_array) || []).forEach(s => { if (s) set.add(String(s)); });
        });
        ((studio && studio.specialty_styles) || []).forEach(s => { if (s) set.add(String(s)); });
        return Array.from(set).slice(0, 30);
    }
    function photos(studio) {
        return (Array.isArray(studio && studio.photo_feed_items) ? studio.photo_feed_items : [])
            .map(p => (typeof p === 'string' ? { url: p } : p))
            .filter(p => p && safeUrl(p.url));
    }
    // E-CODE-PUBLIC-06: sin descripción, sin fotos y sin artistas publicados.
    function isPreparing(studio, memberships) {
        const s = studio || {};
        return !String(s.bio || '').trim() && !photos(s).length && !(Array.isArray(memberships) && memberships.length);
    }

    // Filas del equipo (E-PROFILE-02), filtradas por sede y estilo.
    function teamRows(memberships, locations, filters) {
        const f = filters || {};
        const locById = new Map((locations || []).map(l => [l.id, l]));
        return (Array.isArray(memberships) ? memberships : [])
            .filter(m => !f.location || m.location_id === f.location)
            .filter(m => !f.style || ((m.artists_db && m.artists_db.styles_array) || []).includes(f.style))
            .map(m => {
                const a = m.artists_db || {};
                const styles = (a.styles_array || []).slice(0, 2).join(' y ');
                const loc = locById.get(m.location_id);
                return {
                    title: [a.name || a.username || 'Artista', styles].filter(Boolean).join(' · '),
                    meta: [roleLabel(m.role), loc && (loc.label || loc.city)].filter(Boolean).join(' · '),
                    href: a.username ? '/artist/profile?artist=' + encodeURIComponent(a.username) : ''
                };
            });
    }

    function rowHtml(title, meta, href) {
        const body = '<strong>' + esc(title) + '</strong>' + (meta ? '<span>' + esc(meta) + '</span>' : '');
        return '<li>' + (href ? '<a class="sp-row" href="' + esc(href) + '">' + body + '</a>' : '<div class="sp-row">' + body + '</div>') + '</li>';
    }

    function locationsHtml(locations) {
        const list = Array.isArray(locations) ? locations : [];
        if (!list.length) return '<li><div class="sp-row sp-row--empty"><strong>Todavía no hay sedes publicadas</strong></div></li>';
        return list.map((loc, i) => {
            const line = locationLine(loc);
            const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(line || loc.label || '');
            const meta = [line, loc.is_primary ? 'Sede principal' : ''].filter(Boolean).join(' · ');
            return '<li><div class="sp-row"><strong>' + String(i + 1).padStart(2, '0') + ' · ' + esc(loc.label || loc.city || 'Sede') + '</strong>'
                + '<span>' + esc(meta) + (line ? ' · <a href="' + esc(mapUrl) + '" target="_blank" rel="noopener noreferrer">Cómo llegar</a>' : '') + '</span>'
                + (loc.phone ? '<span>Teléfono: ' + esc(loc.phone) + '</span>' : '') + '</div></li>';
        }).join('');
    }

    function galleryHtml(studio) {
        const list = photos(studio);
        if (!list.length) return '<p class="sp-empty">Todavía no hay imágenes del espacio.</p>';
        const name = (studio && studio.name) || 'el estudio';
        return list.slice(0, 24).map((p, i) => {
            const url = safeUrl(p.url);
            return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir foto ' + (i + 1) + ' de ' + esc(name) + '">'
                + '<img src="' + esc(url) + '" alt="' + esc(p.caption || ('Foto ' + (i + 1) + ' de ' + name)) + '" loading="lazy" decoding="async"></a>';
        }).join('');
    }

    function linksHtml(studio, flags) {
        const s = studio || {};
        const f = flags || {};
        const items = [
            f.hasTeam ? ['#equipo', 'Ver artistas', true] : null,
            ['#acerca', 'Acerca del estudio'],
            f.hasLocations ? ['#sedes', 'Ver todas las sedes'] : null,
            f.hasPhotos ? ['#galeria', 'Galería'] : null,
            f.hasBrands ? ['#marcas', 'Marcas aliadas'] : null,
            ['#resenas', 'Reseñas'],
            igUrl(s.instagram) ? [igUrl(s.instagram), 'Instagram', false, true] : null,
            safeUrl(s.website) ? [safeUrl(s.website), 'Sitio web', false, true] : null,
            waUrl(s.whatsapp) ? [waUrl(s.whatsapp), 'WhatsApp', false, true] : null
        ].filter(Boolean);
        return items.map(([href, label, primary, external]) => '<a class="wo-btn ' + (primary ? 'wo-btn--primary' : 'wo-btn--secondary') + '" href="' + esc(href) + '"'
            + (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + esc(label) + '</a>').join('');
    }

    function aboutRows(studio, locations, styles) {
        const s = studio || {};
        const rows = [];
        const langs = (s.languages || []).filter(Boolean).join(' · ');
        if (s.founded_year || langs) rows.push([s.founded_year ? 'Fundado en ' + s.founded_year : 'Idiomas', s.founded_year ? langs : langs]);
        if (styles.length) rows.push(['Estilos de nuestros artistas', styles.slice(0, 8).join(' · ')]);
        if (locations.length) rows.push([locations.length === 1 ? 'Nuestra sede' : 'Nuestras sedes', locations.map(l => l.label || l.city).filter(Boolean).join(' · ')]);
        if (String(s.bio || '').trim()) rows.push(['Sobre el estudio', String(s.bio).trim()]);
        if (s.is_verified) rows.push(['Estudio verificado', 'We Ötzi revisó la información y la sede del estudio.']);
        if (s.accepts_guest_spots) rows.push(['Recibe artistas invitados', 'El estudio publica guest spots para artistas de otras ciudades.']);
        return rows;
    }

    function preparingRows(studio, memberships, styles) {
        const s = studio || {};
        return [
            ['Descripción', String(s.bio || '').trim() ? 'Disponible' : 'Todavía no agregó una descripción'],
            ['Fotos', photos(s).length ? photos(s).length + ' fotos' : 'Todavía no hay imágenes'],
            ['Artistas', (memberships || []).length ? (memberships || []).length + ' artistas' : 'Todavía no hay artistas publicados'],
            ['Estilos', styles.length ? styles.slice(0, 5).join(' · ') : 'Todavía no hay estilos asociados']
        ];
    }

    // ---------------------------------------------------------------
    // Navegador
    // ---------------------------------------------------------------
    function $(id) { return root.document.getElementById(id); }
    function show(id, visible) { const el = $(id); if (el) el.hidden = !visible; }
    function setText(id, text) { const el = $(id); if (el) el.textContent = text; }

    function renderNotFound() {
        root.document.title = 'Estudio no encontrado · We Ötzi';
        setText('sp-title', 'No encontramos este estudio');
        setText('sp-sub', 'El enlace puede estar incompleto o el estudio ya no está publicado.');
        const tag = $('sp-tag');
        if (tag) { tag.textContent = 'No disponible'; tag.hidden = false; }
        show('sp-loading', false);
        show('sp-profile', false);
        show('sp-not-found', true);
    }

    async function renderMap(locations) {
        const mapEl = $('studio-map');
        const caption = $('sp-map-caption');
        if (!mapEl) return;
        const pinned = (locations || []).filter(l => Number.isFinite(Number(l.latitude)) && Number.isFinite(Number(l.longitude))
            && l.latitude != null && l.longitude != null);
        const cities = Array.from(new Set((locations || []).map(l => l.city).filter(Boolean)));
        if (caption) caption.textContent = [cities.join(' · '), pinned.length ? 'La sede principal aparece en negro' : ''].filter(Boolean).join(' · ');
        if (!pinned.length) {
            mapEl.innerHTML = '<div class="sp-map-empty">Todavía no hay sedes ubicadas en el mapa.</div>';
            return;
        }
        try {
            await root.WeOtziGeocoder.ensureGoogleMapsLoaded({ libraries: ['places'] });
        } catch (_) {
            mapEl.innerHTML = '<div class="sp-map-empty">El mapa no está disponible en este momento. Las direcciones están debajo.</div>';
            return;
        }
        const g = root.google.maps;
        const map = new g.Map(mapEl, {
            center: { lat: Number(pinned[0].latitude), lng: Number(pinned[0].longitude) },
            zoom: pinned.length === 1 ? 14 : 5,
            disableDefaultUI: true,
            zoomControl: true,
            backgroundColor: '#EFEBE1',
            styles: [
                { elementType: 'geometry', stylers: [{ color: '#EFEBE1' }] },
                { elementType: 'labels.text.fill', stylers: [{ color: '#5A5449' }] },
                { elementType: 'labels.text.stroke', stylers: [{ color: '#EFEBE1' }] },
                { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D5CFC0' }] },
                { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FCFCFC' }] },
                { featureType: 'poi', stylers: [{ visibility: 'off' }] },
                { featureType: 'transit', stylers: [{ visibility: 'off' }] }
            ]
        });
        function Pin(position, label, primary) { this.position = position; this.label = label; this.primary = primary; this.div = null; }
        Pin.prototype = new g.OverlayView();
        Pin.prototype.onAdd = function () {
            const div = root.document.createElement('div');
            div.className = 'sp-pin' + (this.primary ? ' sp-pin--primary' : '');
            div.textContent = (this.primary ? '★ ' : '') + this.label;
            this.div = div;
            const panes = this.getPanes();
            (panes.overlayMouseTarget || panes.floatPane).appendChild(div);
        };
        Pin.prototype.draw = function () {
            const proj = this.getProjection();
            const p = proj && proj.fromLatLngToDivPixel(this.position);
            if (!p || !this.div) return;
            this.div.style.left = p.x + 'px';
            this.div.style.top = p.y + 'px';
        };
        Pin.prototype.onRemove = function () { if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div); this.div = null; };
        const bounds = new g.LatLngBounds();
        pinned.forEach((loc, i) => {
            const pos = new g.LatLng(Number(loc.latitude), Number(loc.longitude));
            new Pin(pos, String(i + 1).padStart(2, '0') + ' · ' + (loc.label || loc.city || 'Sede'), loc.is_primary).setMap(map);
            bounds.extend(pos);
        });
        if (pinned.length > 1) {
            map.fitBounds(bounds, 60);
            g.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 13) map.setZoom(13); });
        }
    }

    async function renderBrands(studioId) {
        const section = $('marcas');
        const list = $('sp-brands');
        if (!section || !list || !root.WeotziData.StudioOps) return false;
        const { data: sponsors, error } = await root.WeotziData.StudioOps.listPublicSponsors(studioId);
        if (error || !sponsors || !sponsors.length) { section.hidden = true; return false; }
        const { data: links } = await root.WeotziData.StudioOps.listSponsorArtistsBySponsorIds(sponsors.map(s => s.id));
        const bySponsor = new Map();
        (links || []).forEach(link => {
            const a = link.artists_db || {};
            const arr = bySponsor.get(link.sponsor_id) || [];
            arr.push(a.name || a.username);
            bySponsor.set(link.sponsor_id, arr.filter(Boolean));
        });
        list.innerHTML = sponsors.map(sp => {
            const artists = bySponsor.get(sp.id) || [];
            const meta = [sp.tier ? String(sp.tier).replace(/^\w/, c => c.toUpperCase()) : 'Sponsor', artists.slice(0, 3).join(' · ')].filter(Boolean).join(' · ');
            return rowHtml(sp.name || 'Marca', meta, safeUrl(sp.website));
        }).join('');
        list.querySelectorAll('a.sp-row').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
        section.hidden = false;
        return true;
    }

    function wireTeamFilters(memberships, locations) {
        const locSelect = $('sp-filter-location');
        const styleSelect = $('sp-filter-style');
        const team = $('sp-team');
        const usedLocations = (locations || []).filter(l => (memberships || []).some(m => m.location_id === l.id));
        const styles = aggregatedStyles(memberships, null);
        if (locSelect) locSelect.innerHTML = '<option value="">Todas las sedes</option>' + usedLocations.map(l => '<option value="' + esc(l.id) + '">' + esc(l.label || l.city || 'Sede') + '</option>').join('');
        if (styleSelect) styleSelect.innerHTML = '<option value="">Todos los estilos</option>' + styles.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
        show('sp-filters', (memberships || []).length > 1);
        const paint = () => {
            const rows = teamRows(memberships, locations, { location: locSelect && locSelect.value, style: styleSelect && styleSelect.value });
            team.innerHTML = rows.length
                ? rows.map(r => rowHtml(r.title, r.meta, r.href)).join('')
                : '<li><div class="sp-row sp-row--empty"><strong>' + ((memberships || []).length ? 'No hay artistas con ese filtro' : 'Todavía no hay artistas publicados') + '</strong>'
                    + ((memberships || []).length ? '<span>Probá con otra sede u otro estilo.</span>' : '') + '</div></li>';
        };
        if (locSelect) locSelect.addEventListener('change', paint);
        if (styleSelect) styleSelect.addEventListener('change', paint);
        paint();
    }

    async function render(ref) {
        const D = root.WeotziData;
        const isUuid = UUID_RE.test(ref);
        const { data: studio, error } = await (isUuid ? D.Studios.getById(ref, STUDIO_PUBLIC_COLUMNS) : D.Studios.getBySlug(ref, STUDIO_PUBLIC_COLUMNS));
        if (error) throw error;
        if (!studio || studio.is_active === false) { renderNotFound(); return; }

        const [{ data: locData, error: locError }, { data: rosterData, error: rosterError }] = await Promise.all([
            D.StudioLocations.listActiveByStudio(studio.id),
            D.StudioMemberships.listActiveRosterWithArtists(studio.id)
        ]);
        if (locError) throw locError;
        if (rosterError) throw rosterError;
        const locations = (locData || []).slice().sort((a, b) => Number(b.is_primary === true) - Number(a.is_primary === true));
        const memberships = rosterData || [];
        const primary = primaryLocation(locations);
        const styles = aggregatedStyles(memberships, studio);
        const name = studio.name || 'Estudio';
        const place = primary ? (primary.label || primary.city || '') : (studio.city || '');
        const preparing = isPreparing(studio, memberships);

        root.document.title = name + ' · Estudio en We Ötzi';
        const ogTitle = $('og-title'); if (ogTitle) ogTitle.setAttribute('content', name + ' · We Ötzi');
        const ogDesc = $('og-description'); if (ogDesc) ogDesc.setAttribute('content', studio.tagline || ('Conocé el equipo y las sedes de ' + name + '.'));

        setText('sp-title', preparing ? 'El estudio está preparando su perfil' : name);
        setText('sp-sub', [name, place].filter(Boolean).join(' · '));
        const seal = $('sp-seal');
        if (seal) seal.hidden = studio.is_verified !== true;
        const tag = $('sp-tag');
        if (tag) { tag.textContent = preparing ? 'Sin registros' : ''; tag.hidden = !preparing; }

        const coverUrl = safeUrl(studio.cover_image);
        const cover = $('sp-cover');
        if (cover && coverUrl && !preparing) {
            const img = root.document.createElement('img');
            img.src = coverUrl;
            img.alt = 'Portada de ' + name;
            img.decoding = 'async';
            img.addEventListener('error', () => { cover.hidden = true; });
            cover.replaceChildren(img);
            cover.hidden = false;
        }

        // Banda
        setText('sp-band-mark', initial(name));
        setText('sp-band-name', name);
        setText('sp-band-place', place);
        setText('sp-band-tagline', studio.tagline || 'Tatuajes, encuentros y artistas de todo el mundo.');

        // Perfil en preparación (E-CODE-PUBLIC-06)
        const prep = $('sp-preparing');
        if (prep) {
            prep.innerHTML = preparing ? preparingRows(studio, memberships, styles).map(r => rowHtml(r[0], r[1])).join('') : '';
            prep.hidden = !preparing;
        }
        show('equipo', !preparing);
        show('galeria', !preparing);

        // Equipo + filtros
        if (!preparing) wireTeamFilters(memberships, locations);

        // Conocé el estudio
        setText('sp-about-title', 'Conocé ' + name);
        const about = aboutRows(studio, locations, styles);
        const aboutEl = $('sp-about');
        if (aboutEl) aboutEl.innerHTML = about.length ? about.map(r => rowHtml(r[0], r[1])).join('') : rowHtml('Sobre el estudio', 'Todavía no agregó una descripción');

        // Sedes
        setText('sp-locations-title', primary && primary.city ? 'Encontranos en ' + primary.city : 'Nuestras sedes');
        const locEl = $('sp-locations');
        if (locEl) locEl.innerHTML = locationsHtml(locations);

        // Galería
        setText('sp-gallery-title', 'El espacio de ' + name);
        const gallery = $('sp-gallery');
        if (gallery) gallery.innerHTML = galleryHtml(studio);

        // Lateral
        setText('sp-aside-title', preparing ? 'Información' : 'Tu próximo tatuaje, en ' + name);
        setText('sp-aside-text', preparing
            ? 'Volvé más adelante para conocer los detalles que comparta el estudio.'
            : 'Conocé al equipo residente y a los artistas que nos visitan. Elegí el estilo que buscás y revisá su disponibilidad.');

        show('sp-loading', false);
        show('sp-profile', true);

        let hasBrands = false;
        try { hasBrands = await renderBrands(studio.id); } catch (err) { console.warn('[studio-profile] marcas:', err && err.message); }
        const links = $('sp-links');
        if (links) links.innerHTML = linksHtml(studio, {
            hasTeam: !preparing && memberships.length > 0,
            hasLocations: locations.length > 0,
            hasPhotos: !preparing && photos(studio).length > 0,
            hasBrands
        });

        renderMap(locations).catch(err => console.warn('[studio-profile] mapa:', err && err.message));
        if (root.WeOtziReviews) {
            root.WeOtziReviews.renderPublicReviews({
                mount: 'studio-reviews',
                revieweeType: 'studio',
                revieweeId: studio.id,
                title: 'Reseñas del estudio'
            });
        }
    }

    async function boot() {
        const params = new URLSearchParams(root.location.search);
        const ref = (params.get('studio') || params.get('id') || params.get('slug') || '').trim();
        if (!ref) { renderNotFound(); return; }
        try {
            if (root.ConfigManager && root.ConfigManager.ready) await root.ConfigManager.ready();
            await render(ref);
        } catch (err) {
            console.error('[studio-profile] failed:', err);
            setText('sp-title', 'No pudimos cargar el estudio');
            setText('sp-sub', 'Revisá tu conexión y recargá la página.');
            show('sp-loading', false);
            show('sp-not-found', true);
        }
    }

    return {
        boot,
        STUDIO_PUBLIC_COLUMNS,
        teamRows,
        locationsHtml,
        galleryHtml,
        linksHtml,
        aboutRows,
        preparingRows,
        isPreparing,
        aggregatedStyles,
        initial,
        igUrl,
        waUrl,
        safeUrl
    };
});
