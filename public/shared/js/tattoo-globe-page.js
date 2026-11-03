/* Final Pantalla 11. Atlas behavior is still owned by explore-globe.js. */
(function () {
    'use strict';
    const scriptUrl = document.currentScript.src;
    const assets = new URL('../assets/tattoo-globe/', scriptUrl).href;
    const model = window.TattooGlobeModel;
    const preview = window.WEOTZI_PREVIEW === true;
    const $ = id => document.getElementById(id);
    const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    let screen = model.buildScreen({ preview });
    let saved = screen.savedIds.slice();
    let storageKey = null;
    let atlasReady = false;
    let atlasImport = null;
    let selectedCity = '';
    let directoryFailed = false;
    const atlas = $('tg-atlas');

    function image(name, className = '') {
        return `<img${className ? ` class="${className}"` : ''} src="${assets}${name}.svg" alt="">`;
    }
    function placeholder(city) {
        return `<span class="tg-placeholder" aria-hidden="true">${image('image-slot')}<strong>${escape(city)}</strong><span>or <u>browse files</u></span></span>`;
    }
    function destinationCard(destination, isSaved) {
        const { id, city, country, artists, studios } = destination;
        return `<article class="tg-destination">
            <button type="button" class="tg-destination-link" data-explore-city="${escape(city)}" aria-label="Explorar tatuadores en ${escape(city)}">
                ${placeholder(city)}
                <div class="tg-destination-copy"><h3>${escape(city)}</h3><p>${escape(country)} · ${artists} artistas${isSaved ? '' : ` · ${studios} estudios`}</p>${isSaved ? '' : '<span>Explore</span>'}</div>
            </button>
            ${isSaved ? `<span class="tg-saved-badge">Saved</span><button class="tg-remove" type="button" data-remove-destination="${id}" aria-label="Quitar ${escape(city)} de destinos soñados">${image('remove')}</button>` : ''}
        </article>`;
    }
    function renderSaved() {
        const destinations = saved.map(id => screen.destinations.find(row => row.id === id)).filter(Boolean);
        $('tg-saved').innerHTML = destinations.map(destination => destinationCard(destination, true)).join('');
        $('tg-saved-empty').hidden = destinations.length !== 0;
    }
    function render() {
        $('tg-stamp-count').textContent = `${screen.stamps.length} stamps`;
        $('tg-passport-row').innerHTML = screen.stamps.map(stamp => `<article class="tg-stamp">
            <span class="tg-stamp-emblem" aria-hidden="true"><span class="tg-feather">${image('stamp-feather')}${image('stamp-stem')}${image('stamp-bar')}</span></span>
            <div class="tg-stamp-info"><h3>${escape(stamp.city)}</h3><p class="tg-stamp-country">${escape(stamp.country)}</p><div class="tg-stamp-numbers"><span>${stamp.tattoos} tattoos</span><span>${stamp.artists} artists</span></div></div>
            <span class="tg-stamp-year">${stamp.year}</span>
        </article>`).join('') + `<button class="tg-stamp-next" type="button" id="tg-next-stamp"><span class="tg-plus" aria-hidden="true">${image('plus-vertical')}${image('plus-horizontal')}</span><span>Next stamp</span></button>`;
        $('tg-stats').innerHTML = ['Ciudades', 'Países', 'Tatuajes', 'Artistas', 'Km recorridos'].map((label, index) =>
            `<div><dt>${label}</dt><dd>${screen.journey ? screen.journey[index] : '—'}</dd></div>`).join('');
        $('tg-route').innerHTML = screen.stamps.map(stamp => `<li><span>${escape(stamp.city)}</span></li>`).join('');
        $('tg-route').hidden = screen.stamps.length === 0;
        $('tg-history-status').hidden = preview;
        $('tg-history-status').textContent = 'El historial del pasaporte de cliente todavía no está disponible.';
        $('tg-destinations').innerHTML = screen.destinations.map(destination => destinationCard(destination, false)).join('');
        renderSaved();
        $('tg-next-stamp').addEventListener('click', () => {
            const heading = $('tg-discover-title');
            heading.focus({ preventScroll: true });
            heading.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
        });
    }
    function filterAtlas() {
        document.dispatchEvent(new CustomEvent('tattoo-globe:city', { detail: { city: selectedCity } }));
        $('tg-atlas-title').textContent = selectedCity ? `Tatuadores en ${selectedCity}` : 'Explorar tatuadores';
        const matches = (window.__exploreGlobe?.artistsGeo || []).filter(artist => model.matchesCity(artist, selectedCity));
        $('tg-atlas-status').textContent = directoryFailed
            ? 'No se pudo cargar el directorio. Cerrá el explorador y recargá la página para volver a intentar.' : selectedCity && !matches.length
            ? `No hay tatuadores disponibles en ${selectedCity}. Probá otra ciudad o limpiá los filtros.` : '';
    }
    async function openAtlas(city) {
        selectedCity = city;
        $('tg-atlas-title').textContent = city ? `Tatuadores en ${city}` : 'Explorar tatuadores';
        $('tg-atlas-status').textContent = atlasReady ? '' : 'Cargando atlas…';
        if (!atlas.open) atlas.showModal();
        if (atlasReady) { filterAtlas(); return; }
        try {
            atlasImport ||= import(new URL('explore-globe.js', scriptUrl).href);
            await atlasImport;
        } catch (_) {
            atlasImport = null;
            $('tg-atlas-status').textContent = 'No se pudo cargar el atlas. Cerrá el explorador y volvé a intentar.';
        }
    }
    async function loadSessionAndDirectory() {
        try {
            const client = window.ConfigManager?.getSupabaseClient();
            const { data, error } = client ? await client.auth.getSession() : { data: null };
            if (error) throw error;
            // Local-only wishlist changes are isolated by identity and preview release.
            storageKey = `weotzi:tattoo-globe:saved:${preview ? (window.WEOTZI_PREVIEW_COMMIT || 'local-safe') : 'live'}:${data?.session?.user?.id || 'visitor'}`;
            try { saved = model.readSaved(localStorage.getItem(storageKey), screen.savedIds); } catch (_) { /* storage disabled */ }
            renderSaved();
            if (preview || !client || window.ConfigManager.isDemoMode()) return;
            let response = await window.WeotziData.Artists.listWithLocation('user_id,city,country,studio_id');
            if (response.error) response = await window.WeotziData.Artists.listForMap('user_id,city,country,studio_id');
            if (response.error) throw response.error;
            screen = model.buildScreen({ preview: false, artists: response.data || [] });
            render();
        } catch (_) {
            $('tg-feedback').textContent = 'No se pudo cargar el directorio de destinos. Podés volver a intentarlo desde el globo.';
        }
    }
    render();
    loadSessionAndDirectory();
    document.addEventListener('click', event => {
        const explore = event.target.closest('[data-explore-city]');
        if (explore) openAtlas(explore.dataset.exploreCity);
        const remove = event.target.closest('[data-remove-destination]');
        if (!remove) return;
        const id = remove.dataset.removeDestination;
        const index = saved.indexOf(id);
        saved = saved.filter(savedId => savedId !== id);
        try { if (storageKey) localStorage.setItem(storageKey, JSON.stringify(saved)); } catch (_) { /* Removal still works in memory. */ }
        renderSaved();
        const buttons = $('tg-saved').querySelectorAll('.tg-remove');
        (buttons[Math.min(index, buttons.length - 1)] || $('tg-discover-title')).focus();
        $('tg-feedback').textContent = 'Destino quitado de los guardados de este navegador.';
    });
    $('tg-atlas-close').addEventListener('click', () => atlas.close());
    atlas.addEventListener('cancel', event => {
        if (!$('globe-modal-backdrop').classList.contains('hidden')) event.preventDefault();
    });
    document.addEventListener('tattoo-globe:ready', () => { atlasReady = true; filterAtlas(); });
    document.addEventListener('tattoo-globe:error', () => {
        directoryFailed = true;
        $('tg-atlas-status').textContent = 'No se pudo cargar el directorio. Cerrá el explorador y recargá la página para volver a intentar.';
    });
    $('tattoo-globe-logout').addEventListener('click', async () => {
        const button = $('tattoo-globe-logout');
        button.disabled = true;
        try {
            const client = window.ConfigManager?.getSupabaseClient();
            if (!client) throw new Error('No auth client');
            const { error } = await client.auth.signOut();
            if (error) throw error;
            location.href = `${window.WEOTZI_BASE_PATH || ''}/client/login/`;
        } catch (_) {
            button.disabled = false;
            $('tg-feedback').textContent = 'No se pudo cerrar la sesión. Volvé a intentar.';
        }
    });
    // Reuse the shared menu markup; keep client destinations on this client page.
    const navigation = document.querySelector('weotzi-product-nav');
    navigation.querySelector('.wo-org-product-nav__brand').href = `${window.WEOTZI_BASE_PATH || ''}/client/dashboard/`;
    for (const link of navigation.querySelectorAll('a')) {
        if (link.getAttribute('href')?.endsWith('/my-quotations')) link.href = `${window.WEOTZI_BASE_PATH || ''}/client/dashboard/#mis-cotizaciones`;
        if (link.getAttribute('href')?.endsWith('/artist/inbox')) link.href = `${window.WEOTZI_BASE_PATH || ''}/client/chats/`;
    }
    const toggle = $('globe-menu-toggle');
    const menu = $('globe-mobile-menu');
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !menu.hidden) {
            menu.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            toggle.focus();
        }
    });
}());
