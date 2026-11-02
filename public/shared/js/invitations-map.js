// ================================================================
// WE OTZI - Invitaciones · mapa de estudios
// Figma 2007:5792 "Invitaciones - Mapa de estudios" y 2007:5793 "Mapa de
// estudios detalle" (archivo w3JA83CcP5ISKjyOu87mx1).
// Ruta: /artist/invitations?vista=mapa[&estudio=<studio_id>][&grupo=<id>,<id>…]
//   grupo = estudios del marcador de grupo abierto ("N estudios en este punto").
//
// Globo: la tierra es una superficie rellena (invitations-globe.js, WebGL
// propio) sobre la esfera blanca y la retícula SVG de 10° (d3.geoGraticule10
// del Figma); las fronteras van en un canvas 2D encima. Geografía: Natural
// Earth 1:110m si #ism-stage trae data-geography="<url same-origin>"
// (TopoJSON world-atlas, todavía no vendorizado) o, si no, la máscara de
// tierra de COBE sin fronteras; el pie (#ism-source) dice cuál se usa.
// Marcadores, retícula y contorno se proyectan con la misma matemática
// (invitations-model.js), así siguen siendo botones accesibles.
// Datos: WeotziData.Invitations (sedes + spots abiertos) + invitaciones y
// contactos que ya cargó artist-invitations.js (window.WoInvitationsApp).
// ================================================================

(function () {
    'use strict';

    const M = window.WoInvitationsModel;
    const D = window.WeotziData || {};
    const app = () => window.WoInvitationsApp || {};
    const ZOOMS = [1.16, 1.7, 2.6, 3.8, 5.2];
    const DEFAULT_FOCUS = { lat: 12, lng: -60 };
    const REDUCED_MOTION = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    const AVATAR_TONES = ['ink', 'red', 'blue', 'yellow'];
    // Agrupación de marcadores en px de pantalla: radio de captura y distancia
    // mínima entre centros (un grupo "10" mide ~31px de ancho; con 32px de
    // separación dos grupos no se pisan, tampoco en el globo chico de 390px).
    const CLUSTER_RADIUS = 24;
    const CLUSTER_GAP = 32;
    // Retícula cada 10° como el Figma (2007:5792: meridianos a 10° de Bogotá).
    const GRATICULE_STEP = 10;
    const SOURCE_COBE = 'Geografía: máscara de tierra de COBE · escala aproximada.';
    const SOURCE_NATURAL_EARTH = 'Geografía: Natural Earth · escala 1:110m.';

    const state = {
        mounted: false,
        visible: false,
        loading: null,
        error: null,
        directory: [],
        filtered: [],
        filters: { query: '', country: '', kind: 'all' },
        selectedId: null,
        clusterIds: null,
        zoomIndex: 0,
        view: { phi: 0, theta: 0, scale: ZOOMS[0], width: 1, height: 1 },
        target: { phi: 0, theta: 0, scale: ZOOMS[0] },
        globe: null,
        globeReady: false,
        webgl: true,
        dpr: 1,
        raf: 0,
        drag: null,
        markerNodes: new Map(),
        lastGrid: '',
    };
    const el = {};

    function esc(value) { return app().escapeHtml ? app().escapeHtml(value) : String(value == null ? '' : value); }
    function icon(name) { return `<i data-wo-icon="${name}" aria-hidden="true"></i>`; }
    function cssUrl(value) { return app().cssUrl ? app().cssUrl(value) : String(value); }
    function href(next) { return app().hrefFor ? app().hrefFor(next) : '?'; }

    /* ------------------------------ montaje ------------------------------ */
    function mount() {
        if (state.mounted) return;
        ['inv-map-view', 'ism-stage', 'ism-canvas', 'ism-borders', 'ism-grid', 'ism-markers', 'ism-aside', 'ism-count', 'ism-countries',
            'ism-search', 'ism-country', 'ism-kind', 'ism-all', 'ism-zoom-in', 'ism-zoom-out', 'ism-fallback', 'ism-filters', 'ism-source']
            .forEach((id) => { el[id] = document.getElementById(id); });
        if (!el['ism-stage']) return;
        state.mounted = true;
        const focus = M.focusAngles(DEFAULT_FOCUS.lat, DEFAULT_FOCUS.lng);
        Object.assign(state.view, focus);
        Object.assign(state.target, focus);

        el['ism-filters'].addEventListener('submit', (event) => event.preventDefault());
        el['ism-search'].addEventListener('input', () => {
            state.filters.query = el['ism-search'].value;
            applyFilters();
        });
        el['ism-country'].addEventListener('change', () => {
            state.filters.country = el['ism-country'].value;
            applyFilters({ refocus: true });
        });
        el['ism-kind'].querySelectorAll('[data-kind]').forEach((button) => {
            button.addEventListener('click', () => setKind(button.dataset.kind));
            button.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                event.preventDefault();
                const buttons = [...el['ism-kind'].querySelectorAll('[data-kind]')];
                const index = buttons.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1);
                const next = buttons[(index + buttons.length) % buttons.length];
                setKind(next.dataset.kind);
                next.focus();
            });
        });
        el['ism-all'].addEventListener('click', showAll);
        el['ism-zoom-in'].addEventListener('click', () => zoomBy(1));
        el['ism-zoom-out'].addEventListener('click', () => zoomBy(-1));

        const stage = el['ism-stage'];
        stage.tabIndex = 0;
        stage.setAttribute('role', 'region');
        stage.setAttribute('aria-label', 'Globo con los estudios. Usá las flechas para girar y + o − para acercar.');
        stage.addEventListener('pointerdown', onPointerDown);
        stage.addEventListener('keydown', onStageKey);
        el['ism-markers'].addEventListener('click', onMarkerClick);
        el['ism-aside'].addEventListener('click', onAsideClick);

        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(() => { measure(); requestFrame(); }).observe(stage);
        } else {
            window.addEventListener('resize', () => { measure(); requestFrame(); });
        }
        document.addEventListener('weotzi:studio-contacted', () => {
            rebuildDirectory();
            renderAside();
        });
    }

    function setKind(kind) {
        state.filters.kind = kind || 'all';
        el['ism-kind'].querySelectorAll('[data-kind]').forEach((button) => {
            const active = button.dataset.kind === state.filters.kind;
            button.setAttribute('aria-checked', String(active));
            button.tabIndex = active ? 0 : -1;
        });
        applyFilters();
    }

    /* ------------------------------- datos ------------------------------- */
    function ensureData() {
        if (state.loading) return state.loading;
        state.loading = (async () => {
            if (!D.Invitations) {
                state.error = 'No pudimos cargar el mapa de estudios.';
                return;
            }
            const [locations, spots] = await Promise.all([D.Invitations.listMapLocations(), D.Invitations.listOpenSpots()]);
            if (locations.error) {
                state.error = 'No pudimos cargar los estudios. Probá de nuevo en unos minutos.';
                state.raw = { locations: [], spots: [] };
            } else {
                state.raw = { locations: locations.data || [], spots: spots.error ? [] : (spots.data || []) };
            }
            rebuildDirectory();
            fillCountries();
        })();
        return state.loading;
    }

    function rebuildDirectory() {
        if (!state.raw) return;
        state.directory = M.buildDirectory({
            locations: state.raw.locations,
            spots: state.raw.spots,
            memberships: app().getItems ? app().getItems() : [],
            contacts: app().getContacts ? app().getContacts() : [],
        });
        state.filtered = M.filterDirectory(state.directory, state.filters);
    }

    function fillCountries() {
        const select = el['ism-country'];
        if (!select) return;
        const current = select.value;
        select.innerHTML = '<option value="">Todos los países</option>' + M.countries(state.directory)
            .map((country) => `<option value="${esc(country)}">${esc(country)}</option>`).join('');
        select.value = current;
    }

    function byId(id) { return state.directory.find((studio) => String(studio.id) === String(id)) || null; }

    function applyFilters(options = {}) {
        state.filtered = M.filterDirectory(state.directory, state.filters);
        if (state.clusterIds) {
            state.clusterIds = state.clusterIds.filter((id) => state.filtered.some((s) => s.id === id));
            if (!state.clusterIds.length) state.clusterIds = null;
        }
        if (options.refocus && state.filtered.length && !state.selectedId) {
            const center = M.centroid(state.filtered);
            focus(center.lat, center.lng, state.filters.country ? 2 : 0);
        }
        renderHeader();
        renderAside();
        requestFrame();
    }

    /* ------------------------------- vista ------------------------------- */
    async function show(options = {}) {
        mount();
        if (!state.mounted) return;
        state.visible = true;
        if (!state.raw) el['ism-aside'].innerHTML = '<p class="ism-aside-empty">Cargando estudios…</p>';
        await ensureData();
        if (!state.visible) return;
        rebuildDirectory();
        const studioId = options.studioId || null;
        const groupIds = [...new Set(options.groupIds || [])].filter((id) => byId(id));
        if (groupIds.length) {
            const same = state.clusterIds && state.clusterIds.length === groupIds.length
                && groupIds.every((id) => state.clusterIds.includes(id));
            if (!same) {
                // Grupo abierto desde la URL (QA o enlace compartido): centramos el punto
                // sin acercar; el clic en un marcador de grupo ya acerca por su cuenta.
                state.clusterIds = groupIds;
                if (!studioId) {
                    const center = M.centroid(groupIds.map(byId));
                    focus(center.lat, center.lng, state.zoomIndex, { instant: !state.globeReady });
                }
            }
        } else {
            state.clusterIds = null;
        }
        if (studioId && byId(studioId)) {
            if (state.selectedId !== studioId) {
                state.selectedId = studioId;
                const studio = byId(studioId);
                focus(studio.lat, studio.lng, Math.max(state.zoomIndex, 2), { instant: !state.globeReady });
            }
        } else {
            state.selectedId = null;
        }
        renderHeader();
        renderAside();
        measure();
        state.lastRender = '';
        await initGlobe();
        requestFrame();
    }

    function hide() {
        state.visible = false;
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
    }

    function renderHeader() {
        const total = state.filtered.length;
        const countries = M.countries(state.filtered).length;
        if (el['ism-count']) el['ism-count'].textContent = String(total).padStart(2, '0');
        if (el['ism-countries']) el['ism-countries'].textContent = `${countries} ${countries === 1 ? 'país' : 'países'}`;
    }

    /* ------------------------------- globo ------------------------------- */
    function hasWebGL() {
        try {
            const canvas = document.createElement('canvas');
            return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
        } catch (_) {
            return false;
        }
    }

    async function initGlobe() {
        if (state.globe || state.globeInit) return state.globeInit;
        state.globeInit = (async () => {
            state.webgl = hasWebGL() && !!window.WoInvitationsGlobe;
            if (!state.webgl) { setFallback(true); return; }
            try {
                measure();
                const styles = window.getComputedStyle(el['ism-stage']);
                state.globe = await window.WoInvitationsGlobe.create(el['ism-canvas'], {
                    landColor: styles.getPropertyValue('--figma-sand-border'),
                    rimColor: styles.getPropertyValue('--neutral-500'),
                    borderColor: styles.getPropertyValue('--figma-white'),
                    overlay: el['ism-borders'],
                    onLost: () => { state.globe = null; setFallback(true); setSource(false); },
                });
                if (!state.globe) { setFallback(true); return; }
                state.globeReady = true;
                setFallback(false);
                state.lastRender = '';
                requestFrame();
                loadGeography();
            } catch (error) {
                console.warn('[invitaciones-mapa] globo no disponible:', error);
                state.globe = null;
                setFallback(true);
            }
        })();
        return state.globeInit;
    }

    function setFallback(on) {
        el['ism-stage'].classList.toggle('is-fallback', !!on);
        if (el['ism-fallback']) el['ism-fallback'].hidden = !on;
    }

    // Natural Earth 1:110m (TopoJSON de world-atlas) desde una URL del mismo
    // origen declarada en el HTML. Sin el atributo, o si falla, queda la
    // máscara de COBE y el pie lo dice.
    async function loadGeography() {
        const url = (el['ism-stage'].dataset.geography || '').trim();
        if (!url || !/^\/(?!\/)/.test(url) || !state.globe) return;
        try {
            const response = await fetch(app().appUrl ? app().appUrl(url) : url, { credentials: 'same-origin' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            setGeography(await response.json());
        } catch (error) {
            console.warn('[invitaciones-mapa] sin Natural Earth, se usa la máscara de COBE:', error);
        }
    }

    function setGeography(topology) {
        if (!state.globe || typeof state.globe.setGeography !== 'function') return false;
        const ok = state.globe.setGeography(topology);
        setSource(ok);
        state.lastRender = '';
        requestFrame();
        return ok;
    }

    function setSource(naturalEarth) {
        if (el['ism-source']) el['ism-source'].textContent = naturalEarth ? SOURCE_NATURAL_EARTH : SOURCE_COBE;
    }

    function measure() {
        const stage = el['ism-stage'];
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        state.dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (width === state.view.width && height === state.view.height) return;
        state.view.width = width;
        state.view.height = height;
        const canvas = el['ism-canvas'];
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        el['ism-grid'].setAttribute('viewBox', `0 0 ${width} ${height}`);
        state.resized = true;
        // COBE dimensiona la esfera con el alto: en paneles angostos (mobile)
        // la achicamos para que el globo entero entre a lo ancho.
        const fit = Math.min(1, width / height);
        if (fit !== state.fit) {
            state.fit = fit;
            state.target.scale = zoomScale(state.zoomIndex);
            state.view.scale = state.target.scale;
        }
    }

    function zoomScale(index) {
        return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, index))] * (state.fit || 1);
    }

    function focus(lat, lng, zoomIndex, options = {}) {
        const angles = M.focusAngles(lat, lng);
        state.target.phi = M.nearestAngle(state.view.phi, angles.phi);
        state.target.theta = Math.max(-1.25, Math.min(1.25, angles.theta));
        if (zoomIndex != null) {
            state.zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, zoomIndex));
            state.target.scale = zoomScale(state.zoomIndex);
        }
        if (options.instant || REDUCED_MOTION) Object.assign(state.view, state.target);
        requestFrame();
    }

    function zoomBy(step) {
        state.zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, state.zoomIndex + step));
        state.target.scale = zoomScale(state.zoomIndex);
        if (REDUCED_MOTION) state.view.scale = state.target.scale;
        requestFrame();
    }

    function groupParam() { return state.clusterIds && state.clusterIds.length ? state.clusterIds.join(',') : null; }

    function showAll() {
        const hadState = !!(state.selectedId || state.clusterIds);
        state.clusterIds = null;
        const list = state.filtered.length ? state.filtered : state.directory;
        if (hadState) {
            state.selectedId = null;
            app().navigate({ vista: 'mapa' }, { replace: true, preserveScroll: true });
        }
        if (state.filters.country && list.length) {
            const center = M.centroid(list);
            focus(center.lat, center.lng, 0);
        } else {
            focus(DEFAULT_FOCUS.lat, DEFAULT_FOCUS.lng, 0);
        }
        renderAside();
    }

    function requestFrame() {
        if (!state.visible || state.raf) return;
        state.raf = requestAnimationFrame(frame);
    }

    function frame() {
        state.raf = 0;
        if (!state.visible) return;
        let moving = false;
        if (!state.drag) {
            ['phi', 'theta', 'scale'].forEach((key) => {
                const delta = state.target[key] - state.view[key];
                if (Math.abs(delta) > 0.0005) {
                    state.view[key] += delta * 0.18;
                    moving = true;
                } else {
                    state.view[key] = state.target[key];
                }
            });
        }
        if (state.globe) {
            const view = state.view;
            const key = [view.phi, view.theta, view.scale, view.width, view.height, state.dpr].join('|');
            if (key !== state.lastRender) {
                state.lastRender = key;
                try {
                    state.globe.render({ phi: view.phi, theta: view.theta, scale: view.scale, width: view.width, height: view.height, dpr: state.dpr });
                } catch (error) {
                    console.warn('[invitaciones-mapa] render:', error);
                }
            }
        }
        drawGrid();
        drawMarkers();
        if (moving || state.drag) requestFrame();
    }

    function drawGrid() {
        const view = state.view;
        const circle = M.globeCircle(view);
        const paths = M.graticulePaths(view, GRATICULE_STEP);
        const markup = `<circle class="ism-sphere" cx="${circle.cx.toFixed(1)}" cy="${circle.cy.toFixed(1)}" r="${circle.r.toFixed(1)}"></circle>`
            + `<path class="ism-graticule" d="${paths.join('')}"></path>`
            + `<circle class="ism-outline" cx="${circle.cx.toFixed(1)}" cy="${circle.cy.toFixed(1)}" r="${circle.r.toFixed(1)}"></circle>`;
        if (markup !== state.lastGrid) {
            el['ism-grid'].innerHTML = markup;
            state.lastGrid = markup;
        }
    }

    function drawMarkers() {
        const view = state.view;
        const pad = 10;
        const points = [];
        let selected = null;
        state.filtered.forEach((studio) => {
            const p = M.project(studio.lat, studio.lng, view);
            if (!p.front || p.x < -pad || p.y < -pad || p.x > view.width + pad || p.y > view.height + pad) return;
            if (studio.id === state.selectedId) { selected = { studio, x: p.x, y: p.y }; return; }
            points.push({ id: studio.id, x: p.x, y: p.y });
        });
        const clusters = M.clusterPoints(points, CLUSTER_RADIUS, CLUSTER_GAP);
        const wanted = new Map();
        clusters.forEach((cluster) => {
            if (cluster.ids.length === 1) wanted.set('s:' + cluster.ids[0], { type: 'studio', ids: cluster.ids, x: cluster.x, y: cluster.y });
            else wanted.set('c:' + cluster.ids.slice().sort().join(','), { type: 'cluster', ids: cluster.ids, x: cluster.x, y: cluster.y });
        });
        if (selected) wanted.set('sel:' + selected.studio.id, { type: 'selected', ids: [selected.studio.id], x: selected.x, y: selected.y });

        state.markerNodes.forEach((node, key) => {
            if (!wanted.has(key)) { node.remove(); state.markerNodes.delete(key); }
        });
        wanted.forEach((marker, key) => {
            let node = state.markerNodes.get(key);
            if (!node) {
                node = createMarker(marker);
                state.markerNodes.set(key, node);
                el['ism-markers'].appendChild(node);
            }
            node.style.transform = `translate(${marker.x.toFixed(1)}px, ${marker.y.toFixed(1)}px)`;
        });
    }

    function createMarker(marker) {
        const node = document.createElement('button');
        node.type = 'button';
        node.dataset.ids = marker.ids.join(',');
        if (marker.type === 'cluster') {
            const studios = marker.ids.map(byId).filter(Boolean);
            const cities = [...new Set(studios.map((s) => s.city).filter(Boolean))].slice(0, 3).join(', ');
            node.className = 'ism-marker ism-marker--cluster';
            node.dataset.action = 'cluster';
            node.setAttribute('aria-label', `${marker.ids.length} estudios en ${cities}. Acercar`);
            node.innerHTML = `<span class="ism-cluster">${marker.ids.length}</span>`;
        } else {
            const studio = byId(marker.ids[0]) || {};
            const selected = marker.type === 'selected';
            node.className = 'ism-marker ism-marker--studio' + (selected ? ' is-selected' : '');
            node.dataset.action = 'studio';
            node.setAttribute('aria-label', `${studio.name}, ${studio.city}${selected ? ', seleccionado' : ''}`);
            if (selected) node.setAttribute('aria-pressed', 'true');
            node.innerHTML = selected
                ? `<span class="ism-pin-selected" aria-hidden="true"></span><span class="ism-pin-label"><strong>${esc(studio.name)}</strong><span>${esc(studio.city)}</span></span>`
                : '<span class="ism-pin" aria-hidden="true"></span>';
        }
        return node;
    }

    /* ---------------------------- interacción ---------------------------- */
    function onPointerDown(event) {
        if (event.button !== 0 || event.target.closest('button, a, input, select')) return;
        const stage = el['ism-stage'];
        state.drag = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
        try { stage.setPointerCapture(event.pointerId); } catch (_) { /* sin captura */ }
        stage.classList.add('is-dragging');
        const move = (e) => {
            if (!state.drag) return;
            const dx = e.clientX - state.drag.x;
            const dy = e.clientY - state.drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) state.drag.moved = true;
            state.drag.x = e.clientX;
            state.drag.y = e.clientY;
            const k = 0.0062 / state.view.scale;
            state.view.phi += dx * k;
            state.view.theta = Math.max(-1.25, Math.min(1.25, state.view.theta + dy * k));
            state.target.phi = state.view.phi;
            state.target.theta = state.view.theta;
            requestFrame();
        };
        const up = () => {
            state.drag = null;
            stage.classList.remove('is-dragging');
            stage.removeEventListener('pointermove', move);
            stage.removeEventListener('pointerup', up);
            stage.removeEventListener('pointercancel', up);
            requestFrame();
        };
        stage.addEventListener('pointermove', move);
        stage.addEventListener('pointerup', up);
        stage.addEventListener('pointercancel', up);
    }

    function onStageKey(event) {
        if (event.target !== el['ism-stage']) return;
        const step = 0.12 / state.view.scale;
        const keys = {
            ArrowLeft: () => { state.target.phi += step; },
            ArrowRight: () => { state.target.phi -= step; },
            ArrowUp: () => { state.target.theta = Math.min(1.25, state.target.theta + step); },
            ArrowDown: () => { state.target.theta = Math.max(-1.25, state.target.theta - step); },
            '+': () => zoomBy(1),
            '=': () => zoomBy(1),
            '-': () => zoomBy(-1),
        };
        if (!keys[event.key]) return;
        event.preventDefault();
        keys[event.key]();
        if (REDUCED_MOTION) Object.assign(state.view, state.target);
        requestFrame();
    }

    function onMarkerClick(event) {
        const node = event.target.closest('.ism-marker');
        if (!node) return;
        const ids = node.dataset.ids.split(',');
        if (node.dataset.action === 'cluster') {
            state.clusterIds = ids;
            state.selectedId = null;
            const studios = ids.map(byId).filter(Boolean);
            const center = M.centroid(studios);
            focus(center.lat, center.lng, state.zoomIndex + 1);
            // El grupo queda en la URL (&grupo=) para volver a él y para QA.
            app().navigate({ vista: 'mapa', grupo: groupParam() }, { preserveScroll: true });
            requestAnimationFrame(() => el['ism-aside'].querySelector('.ism-aside-head')?.focus());
        } else {
            selectStudio(ids[0]);
        }
    }

    function selectStudio(studioId) {
        if (!byId(studioId)) return;
        app().navigate({ vista: 'mapa', estudio: studioId, grupo: groupParam() }, { preserveScroll: true });
        requestAnimationFrame(() => el['ism-aside'].querySelector('.ism-aside-head button, .ism-aside-head')?.focus());
    }

    function onAsideClick(event) {
        const target = event.target.closest('[data-ism]');
        if (!target) return;
        const action = target.dataset.ism;
        if (action === 'select') { event.preventDefault(); selectStudio(target.dataset.id); }
        else if (action === 'back') {
            event.preventDefault();
            app().navigate({ vista: 'mapa', grupo: groupParam() }, { preserveScroll: true });
        } else if (action === 'all') {
            event.preventDefault();
            state.clusterIds = null;
            app().navigate({ vista: 'mapa' }, { replace: true, preserveScroll: true });
        } else if (action === 'contact') {
            const studio = byId(target.dataset.id);
            if (!studio || !window.WoInvitationsStudio) return;
            window.WoInvitationsStudio.openContact({
                studioId: studio.id,
                studioName: studio.name,
                guestStart: studio.opportunities.guest.start,
                guestEnd: studio.opportunities.guest.end,
                reason: studio.opportunities.guest.open ? 'guest_spot' : studio.opportunities.resident.open ? 'resident' : 'other',
                hasAccount: studio.hasAccount,
                acceptsInquiries: studio.acceptsInquiries,
                trigger: target,
            });
        } else if (action === 'profile' || action === 'invitation') {
            // Los enlaces con data-inv-nav los resuelve artist-invitations.js.
        }
    }

    /* ------------------------------- aside ------------------------------- */
    function currentList() {
        if (state.clusterIds) return state.clusterIds.map(byId).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'es'));
        return state.filtered;
    }

    function avatarTone(studio) {
        let hash = 0;
        String(studio.id).split('').forEach((ch) => { hash = (hash * 31 + ch.charCodeAt(0)) >>> 0; });
        return AVATAR_TONES[hash % AVATAR_TONES.length];
    }

    function renderAside() {
        const aside = el['ism-aside'];
        if (!aside) return;
        if (state.error && !state.directory.length) {
            aside.innerHTML = `<p class="ism-aside-empty" role="alert">${esc(state.error)}</p>`;
            return;
        }
        const selected = state.selectedId ? byId(state.selectedId) : null;
        aside.innerHTML = selected ? detailHtml(selected) : listHtml();
    }

    function badgesHtml(studio) {
        const kinds = studio.opportunities;
        const badges = [];
        if (kinds.guest.open) badges.push('<span class="ism-badge ism-badge--guest">Guest spot</span>');
        if (kinds.resident.open) badges.push('<span class="ism-badge ism-badge--resident">Residencia</span>');
        return badges.length ? `<span class="ism-badges">${badges.join('')}</span>` : '';
    }

    function listHtml() {
        const list = currentList();
        const inPoint = !!state.clusterIds;
        const label = inPoint
            ? `${list.length} ${list.length === 1 ? 'estudio' : 'estudios'} en este punto`
            : `${list.length} ${list.length === 1 ? 'estudio' : 'estudios'} en el mapa`;
        const items = list.length ? list.map((studio) => `
            <li>
                <button type="button" class="ism-item" data-ism="select" data-id="${esc(studio.id)}">
                    <span class="ism-avatar ism-avatar--${avatarTone(studio)}" aria-hidden="true">${esc(studio.initials)}</span>
                    <span class="ism-item-text">
                        <strong>${esc(studio.name)}</strong>
                        <span class="ism-item-place">${esc([studio.city, studio.country].filter(Boolean).join(' · '))}</span>
                        ${badgesHtml(studio)}
                        ${studio.opportunities.guest.dates ? `<span class="ism-item-dates">Guests · ${esc(studio.opportunities.guest.dates)}</span>` : ''}
                    </span>
                    ${icon('chevron-right')}
                </button>
            </li>`).join('') : '<li class="ism-aside-empty">No hay estudios con estos filtros. Probá con otra búsqueda o país.</li>';
        return `
            <div class="ism-aside-head" tabindex="-1">
                <span class="ism-aside-title">${esc(label)}</span>
                ${inPoint ? '<button type="button" class="ism-aside-link" data-ism="all">Ver todos</button>' : ''}
            </div>
            <ul class="ism-list" aria-label="Resultados">${items}</ul>`;
    }

    function detailHtml(studio) {
        const list = currentList();
        const index = list.findIndex((s) => s.id === studio.id);
        const position = index >= 0 ? `${index + 1} de ${list.length}` : '';
        const opp = studio.opportunities;
        const eyebrow = [studio.locality, [studio.city, studio.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
        const rows = [];
        if (opp.guest.open) rows.push(['Guest spot', opp.guest.dates ? 'Fechas abiertas' : 'Recibe guests', opp.guest.dates || 'Fechas a coordinar']);
        if (opp.resident.open) rows.push(['Residencia', 'Busca artista residente', opp.resident.split || 'Condiciones a coordinar']);
        const contact = M.contactSummary(studio.contact);
        const membership = studio.membership;
        const canWrite = studio.hasAccount && studio.acceptsInquiries;
        return `
            <div class="ism-aside-head" tabindex="-1">
                <button type="button" class="ism-aside-back" data-ism="back">${icon('arrow-left')} Volver a resultados</button>
                ${position ? `<span class="ism-aside-count">${esc(position)}</span>` : ''}
            </div>
            <div class="ism-detail">
                ${studio.photo
                    ? `<div class="ism-detail-photo" style="background-image:url('${cssUrl(studio.photo)}')" role="img" aria-label="Foto de ${esc(studio.name)}"></div>`
                    : `<div class="ism-detail-photo ism-detail-photo--empty">${icon('image')}<span>Foto de ${esc(studio.name)}</span></div>`}
                <div class="ism-detail-body">
                    <div class="ism-detail-id">
                        ${eyebrow ? `<span class="ism-eyebrow">${esc(eyebrow)}</span>` : ''}
                        <h2 class="ism-detail-name">${esc(studio.name)}</h2>
                    </div>
                    ${studio.tagline ? `<p class="ism-detail-tagline">${esc(studio.tagline)}</p>` : ''}
                    ${studio.styles.length ? `<div class="ism-styles"><span class="ism-label">Estilos</span><div class="ism-chips">${studio.styles.map((style) => `<span class="ism-chip">${esc(style)}</span>`).join('')}</div></div>` : ''}
                    ${rows.length ? `<dl class="ism-desc">${rows.map(([term, title, value]) => `<div><dt>${esc(term)}</dt><dd><strong>${esc(title)}</strong><span>${esc(value)}</span></dd></div>`).join('')}</dl>` : ''}
                    ${membership ? `<p class="ism-line"><i class="ism-line-dot ism-line-dot--invite" aria-hidden="true"></i><span>${esc(M.invitationLine(membership))}</span><a href="${esc(href({ invitacion: membership.id }))}" data-inv-nav="invitation" data-invitation="${esc(membership.id)}">Ver invitación</a></p>` : ''}
                    ${contact ? `<p class="ism-line"><i class="ism-line-dot ism-line-dot--contact" aria-hidden="true"></i><span>${esc(contact.sentence)}</span><a href="${esc(app().appUrl ? app().appUrl('/artist/inbox?thread=' + encodeURIComponent(contact.threadId || studio.id)) : '#')}">Ver conversación</a></p>` : ''}
                    ${canWrite ? '' : `<p class="ism-note">${esc(studio.acceptsInquiries ? 'Este estudio todavía no tiene cuenta en We Ötzi.' : 'Este estudio no recibe consultas por ahora.')}</p>`}
                </div>
            </div>
            <div class="ism-detail-actions">
                <button type="button" class="ism-btn ism-btn--accent" data-ism="contact" data-id="${esc(studio.id)}" ${canWrite ? '' : 'disabled'}>${icon('message-circle')} Contactar estudio</button>
                <a class="ism-btn" href="${esc(href({ estudio: studio.id }))}" data-inv-nav="studio" data-studio="${esc(studio.id)}">Ver perfil completo ${icon('arrow-right')}</a>
            </div>`;
    }

    // setGeography(topology): carga Natural Earth en caliente (QA o datos vendorizados).
    window.WoInvitationsMap = { show, hide, setGeography };
})();
