/**
 * GLOBE APP — orquestación UI de /explore/globe
 *
 * Search-first: el globo entra limpio (sin labels); toda la información
 * aparece al buscar o al seleccionar un marcador.
 *
 *   - Typeahead agrupado: Artistas / Estudios / Ciudades / Estilos.
 *   - Tarjeta de artista: perfil + CTAs + timeline de itinerario + "Ver viaje".
 *   - Tarjeta de estudio: todas las sedes destacadas en el globo, clic = volar.
 *   - Modo tour: el avión recorre el itinerario en orden y en cada parada
 *     salta la tarjeta de esa ciudad (fechas, estudio, estado de agenda).
 */

import { GlobeEngine } from '/shared/js/globe/globe-engine.js';
import {
    waitForConfigManager, fetchArtists, fetchStudios,
    fetchArtistItinerary, buildSearchIndex
} from '/shared/js/globe/globe-data.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return '';
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtRange(entry) {
    if (entry.period_type === 'current') return 'Ahora';
    const a = fmtDate(entry.start_date), b = fmtDate(entry.end_date);
    if (a && b) return `${a} → ${b}`;
    return a || b || 'Próximamente';
}

const TYPE_LABELS = { artist: 'Artistas', studio: 'Estudios', city: 'Ciudades', style: 'Estilos' };
const TYPE_ICONS = {
    artist: 'fa-solid fa-pen-nib', studio: 'fa-solid fa-shop',
    city: 'fa-solid fa-location-dot', style: 'fa-solid fa-palette'
};

const App = {
    engine: null,
    artists: [],
    studios: [],
    index: null,
    artistsById: new Map(),
    studiosById: new Map(),
    markerMeta: new Map(),   // markerId -> { kind, artist? , studio?, location? }
    selection: null,         // { kind, ... }
    tour: null,

    async boot() {
        const stage = $('globe-stage');
        this.engine = new GlobeEngine(stage);

        const [ok] = await Promise.all([
            waitForConfigManager(),
            this.engine.init()
        ]);
        $('globe-status').textContent = '';

        if (!ok) {
            this._setStatus('No se pudo conectar con la configuración.');
            return;
        }

        const [artists, studios] = await Promise.all([fetchArtists(), fetchStudios()]);
        this.artists = artists;
        this.studios = studios;
        artists.forEach(a => this.artistsById.set(a.user_id, a));
        studios.forEach(s => this.studiosById.set(s.id, s));
        this.index = buildSearchIndex(artists, studios);

        this._installMarkers();
        this._bindSearch();
        this._bindEngineEvents();
        this._bindGlobalKeys();

        const counter = $('globe-counter');
        if (counter) {
            counter.textContent = `${artists.length} artistas · ${studios.length} estudios`;
        }
        document.body.classList.add('globe-ready');
        console.log(`[globe] listo — backend: ${this.engine.backend}`);
    },

    _setStatus(msg) {
        const el = $('globe-status');
        if (el) el.textContent = msg || '';
    },

    _installMarkers() {
        const markers = [];
        this.artists.forEach(a => {
            const id = `a:${a.user_id}`;
            markers.push({ id, lat: a.latitude, lng: a.longitude, kind: 'artist' });
            this.markerMeta.set(id, { kind: 'artist', artist: a });
        });
        this.studios.forEach(s => s.locations.forEach(l => {
            const id = `s:${s.id}:${l.id}`;
            markers.push({ id, lat: l.latitude, lng: l.longitude, kind: 'studio' });
            this.markerMeta.set(id, { kind: 'studio', studio: s, location: l });
        }));
        this.engine.setMarkers(markers);
    },

    // ---------------------------------------------------------------
    // Eventos del motor (pick / hover)
    // ---------------------------------------------------------------
    _bindEngineEvents() {
        this.engine.onPick((id) => {
            if (!id) { this.clearSelection(); return; }
            const meta = this.markerMeta.get(id);
            if (!meta) return;
            if (meta.kind === 'artist') this.selectArtist(meta.artist);
            else this.selectStudio(meta.studio, meta.location);
        });

        const tip = $('globe-tip');
        this.engine.onHover((id, x, y) => {
            if (!id) { tip.hidden = true; return; }
            const meta = this.markerMeta.get(id);
            if (!meta) { tip.hidden = true; return; }
            tip.textContent = meta.kind === 'artist'
                ? meta.artist.name || meta.artist.username
                : `${meta.studio.name}${meta.location.label ? ' · ' + meta.location.label : ''}`;
            tip.style.left = `${x + 14}px`;
            tip.style.top = `${y + 10}px`;
            tip.hidden = false;
        });
    },

    _bindGlobalKeys() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.tour) this.exitTour();
                else this.clearSelection();
            }
        });
        $('card-close')?.addEventListener('click', () => this.clearSelection());
        $('tour-exit')?.addEventListener('click', () => this.exitTour());
        $('tour-next')?.addEventListener('click', () => this.tour?.skipWait?.());
    },

    // ---------------------------------------------------------------
    // Búsqueda
    // ---------------------------------------------------------------
    _bindSearch() {
        const input = $('globe-search-input');
        const results = $('globe-search-results');
        let cursor = -1;
        let items = [];

        const close = () => { results.hidden = true; cursor = -1; };
        const render = () => {
            if (!items.length) { close(); return; }
            let html = '';
            let lastType = null;
            items.forEach((e, i) => {
                if (e.type !== lastType) {
                    html += `<div class="gsr-group">${TYPE_LABELS[e.type]}</div>`;
                    lastType = e.type;
                }
                html += `
                  <button class="gsr-item ${i === cursor ? 'is-active' : ''}" data-i="${i}">
                    <i class="${TYPE_ICONS[e.type]}"></i>
                    <span class="gsr-label">${escapeHtml(e.label)}</span>
                    <span class="gsr-sub">${escapeHtml(e.sub)}</span>
                  </button>`;
            });
            results.innerHTML = html;
            results.hidden = false;
            results.querySelectorAll('.gsr-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._chooseResult(items[Number(btn.dataset.i)]);
                    input.blur(); close();
                });
            });
        };

        let deb = null;
        input.addEventListener('input', () => {
            clearTimeout(deb);
            deb = setTimeout(() => {
                const raw = this.index ? this.index.search(input.value) : [];
                // Agrupar por tipo manteniendo el orden de score dentro de cada grupo
                const order = ['artist', 'studio', 'city', 'style'];
                items = order.flatMap(t => raw.filter(e => e.type === t));
                cursor = -1;
                render();
            }, 120);
        });
        input.addEventListener('keydown', (e) => {
            if (results.hidden) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(cursor + 1, items.length - 1); render(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(cursor - 1, 0); render(); }
            else if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); this._chooseResult(items[cursor]); input.blur(); close(); }
            else if (e.key === 'Escape') close();
        });
        document.addEventListener('pointerdown', (e) => {
            if (!results.contains(e.target) && e.target !== input) close();
        });
    },

    _chooseResult(entry) {
        if (!entry) return;
        if (entry.type === 'artist') this.selectArtist(entry.ref);
        else if (entry.type === 'studio') this.selectStudio(entry.ref, null);
        else if (entry.type === 'city') this.selectCity(entry.ref);
        else if (entry.type === 'style') this.selectStyle(entry.ref);
    },

    // ---------------------------------------------------------------
    // Selecciones
    // ---------------------------------------------------------------
    clearSelection() {
        this.selection = null;
        this.engine.select(null);
        this.engine.highlight([]);
        this.engine.setDimmed(null);
        this.engine.clearItinerary();
        this.engine.setAutoRotate(true);
        $('globe-card').hidden = true;
    },

    async selectArtist(artist) {
        this.exitTour();
        this.selection = { kind: 'artist', artist };
        const markerId = `a:${artist.user_id}`;
        this.engine.setDimmed(null);
        this.engine.highlight([]);
        this.engine.select(markerId);
        this.engine.focusOn(artist.latitude, artist.longitude);

        const styles = (artist.styles || []).slice(0, 4)
            .map(s => `<span class="chip">${escapeHtml(s)}</span>`).join('');
        const loc = [artist.city, artist.country].filter(Boolean).join(', ');
        this._renderCard(`
          <div class="card-head">
            <img class="card-avatar" src="${escapeHtml(artist.profile_picture || '/shared/assets/placeholders/gallery-default.svg')}"
                 alt="" onerror="this.src='/shared/assets/placeholders/gallery-default.svg'">
            <div>
              <h2>${escapeHtml(artist.name || artist.username)}</h2>
              <p class="card-sub"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(loc)}</p>
            </div>
          </div>
          ${styles ? `<div class="card-chips">${styles}</div>` : ''}
          ${artist.session_price ? `<p class="card-price">Sesión desde <strong>${escapeHtml(artist.session_price)}</strong></p>` : ''}
          <div class="card-actions">
            <button class="btn-primary" data-act="quote">Cotizar</button>
            <button class="btn-ghost" data-act="profile">Ver perfil</button>
          </div>
          <div id="card-itinerary"></div>
        `);
        const card = $('globe-card');
        card.querySelector('[data-act="quote"]').onclick = () =>
            location.href = '/quotation?artist=' + encodeURIComponent(artist.username || '');
        card.querySelector('[data-act="profile"]').onclick = () =>
            location.href = '/artist/profile?artist=' + encodeURIComponent(artist.username || '');

        // Itinerario (lazy)
        const slot = $('card-itinerary');
        slot.innerHTML = '<p class="card-loading">Cargando agenda…</p>';
        const stops = await fetchArtistItinerary(artist.user_id);
        if (this.selection?.artist !== artist) return; // cambió la selección
        if (!stops.length) { slot.innerHTML = ''; return; }

        const rows = stops.map((s, i) => `
          <li class="itin-row ${s.period_type === 'current' ? 'is-current' : ''}">
            <span class="itin-n">${i + 1}</span>
            <div>
              <strong>${escapeHtml(s.city || s.formatted_address || '—')}</strong>
              <span class="itin-dates">${escapeHtml(fmtRange(s))}</span>
              ${s.studio_name ? `<span class="itin-studio"><i class="fa-solid fa-shop"></i> ${escapeHtml(s.studio_name)}</span>` : ''}
            </div>
          </li>`).join('');
        slot.innerHTML = `
          <h3 class="itin-title"><i class="fa-solid fa-route"></i> Itinerario</h3>
          <ol class="itin-list">${rows}</ol>
          ${stops.length > 1 ? '<button class="btn-tour" id="btn-tour"><i class="fa-solid fa-plane"></i> Ver viaje</button>' : ''}
        `;
        if (stops.length > 1) {
            this.engine.drawItineraryStatic(stops);
            $('btn-tour').onclick = () => this.startTour(artist, stops);
        }
    },

    selectStudio(studio, sede) {
        this.exitTour();
        this.selection = { kind: 'studio', studio };
        const sedeIds = studio.locations.map(l => `s:${studio.id}:${l.id}`);
        this.engine.setDimmed(null);
        this.engine.select(null);
        this.engine.highlight(sedeIds);
        const focus = sede || studio.locations[0];
        this.engine.focusOn(focus.latitude, focus.longitude);

        const sedes = studio.locations.map(l => `
          <li class="sede-row" data-loc="${escapeHtml(l.id)}">
            <i class="fa-solid fa-location-dot"></i>
            <div>
              <strong>${escapeHtml(l.label || l.city || 'Sede')}</strong>
              <span>${escapeHtml([l.city, l.country].filter(Boolean).join(', '))}</span>
            </div>
            ${l.is_primary ? '<span class="chip chip-primary">Principal</span>' : ''}
          </li>`).join('');

        this._renderCard(`
          <div class="card-head">
            <img class="card-avatar card-avatar-studio"
                 src="${escapeHtml(studio.logo_image || '/shared/assets/placeholders/gallery-default.svg')}"
                 alt="" onerror="this.src='/shared/assets/placeholders/gallery-default.svg'">
            <div>
              <h2>${escapeHtml(studio.name)} ${studio.is_verified ? '<i class="fa-solid fa-circle-check verified"></i>' : ''}</h2>
              <p class="card-sub">${escapeHtml(studio.tagline || 'Estudio de tatuaje')}</p>
            </div>
          </div>
          <h3 class="itin-title"><i class="fa-solid fa-building"></i> ${studio.locations.length === 1 ? 'Sede' : studio.locations.length + ' sedes'}</h3>
          <ul class="sede-list">${sedes}</ul>
          <div class="card-actions">
            <button class="btn-primary" data-act="studio-profile">Ver estudio</button>
          </div>
        `);
        const card = $('globe-card');
        card.querySelector('[data-act="studio-profile"]').onclick = () => {
            window.location.href = '/studio/profile?studio=' + encodeURIComponent(studio.slug || studio.id);
        };
        card.querySelectorAll('.sede-row').forEach(row => {
            row.addEventListener('click', () => {
                const l = studio.locations.find(x => String(x.id) === row.dataset.loc);
                if (l) this.engine.focusOn(l.latitude, l.longitude, { distance: 2.0 });
            });
        });
    },

    selectCity(city) {
        this.exitTour();
        this.selection = { kind: 'city', city };
        this.engine.select(null);
        this.engine.highlight([]);
        this.engine.focusOn(city.lat, city.lng, { distance: 2.1 });

        const inCity = (a) => a.city && a.city.toLowerCase() === city.city.toLowerCase();
        const artists = this.artists.filter(inCity).slice(0, 8);
        const studios = this.studios.filter(s => s.locations.some(l => l.city && l.city.toLowerCase() === city.city.toLowerCase()));
        const rows = [
            ...artists.map(a => `<li class="city-row" data-kind="a" data-id="${escapeHtml(a.user_id)}">
                <i class="fa-solid fa-pen-nib"></i><span>${escapeHtml(a.name || a.username)}</span></li>`),
            ...studios.map(s => `<li class="city-row" data-kind="s" data-id="${escapeHtml(s.id)}">
                <i class="fa-solid fa-shop"></i><span>${escapeHtml(s.name)}</span></li>`)
        ].join('');
        this._renderCard(`
          <div class="card-head"><div>
            <h2>${escapeHtml(city.city)}</h2>
            <p class="card-sub">${escapeHtml(city.country || '')}</p>
          </div></div>
          <ul class="sede-list">${rows || '<li class="card-loading">Sin resultados aquí todavía.</li>'}</ul>
        `);
        $('globe-card').querySelectorAll('.city-row').forEach(row => {
            row.addEventListener('click', () => {
                if (row.dataset.kind === 'a') this.selectArtist(this.artistsById.get(row.dataset.id));
                else this.selectStudio(this.studiosById.get(row.dataset.id), null);
            });
        });
    },

    selectStyle(style) {
        this.exitTour();
        this.selection = { kind: 'style', style };
        const ids = new Set();
        this.artists.forEach(a => {
            if (a.styles.some(s => s.toLowerCase() === style.style.toLowerCase())) {
                ids.add(`a:${a.user_id}`);
            }
        });
        this.engine.select(null);
        this.engine.highlight([]);
        this.engine.setDimmed(ids);
        this.engine.setAutoRotate(true);
        this._renderCard(`
          <div class="card-head"><div>
            <h2>${escapeHtml(style.style)}</h2>
            <p class="card-sub">${ids.size} artista${ids.size === 1 ? '' : 's'} en el mundo</p>
          </div></div>
          <p class="card-hint">Los puntos apagados no hacen este estilo. Toca un punto encendido para ver al artista.</p>
          <div class="card-actions"><button class="btn-ghost" data-act="clear">Quitar filtro</button></div>
        `);
        $('globe-card').querySelector('[data-act="clear"]').onclick = () => this.clearSelection();
    },

    _renderCard(html) {
        const card = $('globe-card');
        card.querySelector('.card-body').innerHTML = html;
        card.hidden = false;
    },

    // ---------------------------------------------------------------
    // Tour del itinerario
    // ---------------------------------------------------------------
    startTour(artist, stops) {
        $('globe-card').hidden = true;
        $('globe-tour').hidden = false;
        $('tour-artist').textContent = artist.name || artist.username;
        const stopCard = $('tour-stop');

        const AUTO_MS = 3200;
        const showStop = (stop, i) => new Promise((resolve) => {
            stopCard.classList.remove('pop');
            void stopCard.offsetWidth; // reinicia la animación
            stopCard.innerHTML = `
              <span class="tour-n">${i + 1}/${stops.length}</span>
              <h3>${escapeHtml(stop.city || stop.formatted_address || '—')}</h3>
              <p class="tour-dates">${escapeHtml(fmtRange(stop))}</p>
              ${stop.studio_name ? `<p class="tour-studio"><i class="fa-solid fa-shop"></i> ${escapeHtml(stop.studio_name)}</p>` : ''}
              ${stop.agenda_status ? `<span class="chip">${escapeHtml(stop.agenda_status)}</span>` : ''}
            `;
            stopCard.classList.add('pop');
            const t = setTimeout(done, AUTO_MS);
            function done() { clearTimeout(t); resolve(); }
            App.tour.skipWait = done;
        });

        const tour = this.engine.playTour(stops, {
            onArrive: (stop, i) => showStop(stop, i),
            onDepart: (stop, i) => {
                const next = stops[i + 1];
                stopCard.classList.remove('pop');
                stopCard.innerHTML = `
                  <p class="tour-flying"><i class="fa-solid fa-plane"></i>
                  Volando a <strong>${escapeHtml(next?.city || '…')}</strong></p>`;
            },
            onEnd: () => this.exitTour(true)
        });
        tour.skipWait = null;
        this.tour = tour;
    },

    exitTour(keepSelection = false) {
        if (this.tour) {
            this.tour.cancel();
            this.tour = null;
        }
        $('globe-tour').hidden = true;
        if (!keepSelection) {
            this.engine.clearItinerary();
        } else if (this.selection?.kind === 'artist') {
            // Volver a la tarjeta del artista al terminar el viaje
            $('globe-card').hidden = false;
            this.engine.select(`a:${this.selection.artist.user_id}`);
        }
    }
};

window.addEventListener('DOMContentLoaded', () => {
    App.boot().catch(err => {
        console.error('[globe] error de arranque:', err);
        const st = $('globe-status');
        if (st) st.textContent = 'No se pudo iniciar el globo en este dispositivo.';
    });
});

export { App };
