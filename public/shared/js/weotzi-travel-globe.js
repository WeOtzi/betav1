/**
 * <weotzi-travel-globe>
 *
 * Reusable Travel globe component. It owns the COBE canvas, route controls,
 * accessible stop details, fallback and lifecycle. Consumers only provide
 * Travel data and listen for `travel-stop-select` / `travel-view-trip`.
 */
(function exposeWeotziTravelGlobe(root, factory) {
    'use strict';

    const api = factory(root || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.WeotziTravelGlobe = Object.assign(root.WeotziTravelGlobe || {}, api);
        api.defineTravelGlobeElement(root);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTravelGlobeComponent(root) {
    'use strict';

    const tagName = 'weotzi-travel-globe';
    const BaseElement = typeof root.HTMLElement === 'function' ? root.HTMLElement : class {};
    const STATUS_LABELS = {
        planificado: 'Planificado',
        pendiente: 'Pendiente',
        confirmado: 'Confirmado',
        finalizado: 'Finalizado',
        cancelado: 'Cancelado',
    };
    const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function shortDate(value) {
        const parts = String(value || '').split('-').map(Number);
        if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return '—';
        return `${parts[2]} ${MONTHS[parts[1] - 1] || ''}`.trim();
    }

    function legacyFallback(route) {
        const count = route?.stops?.length || 0;
        return `<div class="tvl-cobe-loading" role="status">
            <span>Cargando globo interactivo</span>
            <small>${count} ${count === 1 ? 'parada preparada' : 'paradas preparadas'}</small>
        </div>`;
    }

    // ------------------------------------------------------------------
    // Modo "wireframe" (Figma final 801:1076): globo de líneas estático,
    // rutas desde la base a cada parada y la próxima parada resaltada con
    // una ruta punteada amarilla. Sin WebGL, sin halo y sin tooltips.
    // ------------------------------------------------------------------
    const DEG = Math.PI / 180;
    const BASE_ABBREVIATIONS = {
        'buenos aires': 'Bs. As.',
        'ciudad autonoma de buenos aires': 'Bs. As.',
        'caba': 'Bs. As.',
        'ciudad de mexico': 'CDMX',
        'mexico city': 'CDMX',
        'sao paulo': 'São Paulo',
        'rio de janeiro': 'Río',
        'nueva york': 'NYC',
        'new york': 'NYC',
    };

    function normalizePlace(value) {
        return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    }

    /** "Buenos Aires" → "Bs. As." (Figma: "Tu base · Bs. As."). */
    function abbreviateBaseCity(city) {
        const key = normalizePlace(city);
        return BASE_ABBREVIATIONS[key] || String(city || '').trim();
    }

    function wireframeBaseLabel(base) {
        if (!base) return '';
        const place = abbreviateBaseCity(base.city) || String(base.country || '').trim() || 'origen';
        return `Tu base · ${place}`;
    }

    function clampNumber(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    /** Proyección ortográfica centrada en (lat0, lng0): vector unitario en coordenadas de vista. */
    function orthoVector(location, center) {
        const lat = Number(location[0]) * DEG;
        const lng = Number(location[1]) * DEG;
        const lat0 = center[0] * DEG;
        const dLng = lng - center[1] * DEG;
        return [
            Math.cos(lat) * Math.sin(dLng),
            Math.cos(lat0) * Math.sin(lat) - Math.sin(lat0) * Math.cos(lat) * Math.cos(dLng),
            Math.sin(lat0) * Math.sin(lat) + Math.cos(lat0) * Math.cos(lat) * Math.cos(dLng),
        ];
    }

    function wireframeGeometry(width, height) {
        const w = Math.max(1, width);
        const h = Math.max(1, height);
        // Figma: panel 960 × 986 · círculo centrado en (480, 478) con radio 392.
        const radius = Math.max(40, Math.min(w * 0.408, h * 0.398));
        return { width: w, height: h, cx: w / 2, cy: h * 0.485, radius };
    }

    function wireframeCenter(route) {
        const anchor = route?.base?.location || route?.stops?.[0]?.location || [0, 0];
        // La base queda abajo al centro y los destinos se abren hacia arriba.
        return [clampNumber(Number(anchor[0]) + 35, -55, 55), Number(anchor[1]) + 8];
    }

    function toScreen(vector, geometry, lift) {
        const factor = lift || 1;
        return {
            x: geometry.cx + geometry.radius * vector[0] * factor,
            y: geometry.cy - geometry.radius * vector[1] * factor,
            front: vector[2] >= 0,
        };
    }

    function arcPath(from, to, geometry) {
        const dot = clampNumber(from[0] * to[0] + from[1] * to[1] + from[2] * to[2], -1, 1);
        const omega = Math.acos(dot);
        const steps = 28;
        const points = [];
        for (let index = 0; index <= steps; index += 1) {
            const t = index / steps;
            let vector;
            if (omega < 0.0001) {
                vector = from;
            } else {
                const a = Math.sin((1 - t) * omega) / Math.sin(omega);
                const b = Math.sin(t * omega) / Math.sin(omega);
                vector = [a * from[0] + b * to[0], a * from[1] + b * to[1], a * from[2] + b * to[2]];
            }
            const lift = 1 + 0.16 * Math.sin(Math.PI * t) * Math.min(1, omega / 1.1);
            const point = toScreen(vector, geometry, lift);
            points.push(`${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`);
        }
        return points.join(' ');
    }

    function wireframeStatusClass(status) {
        const key = String(status || '').toLowerCase();
        if (key === 'confirmado') return 'confirmado';
        if (key === 'finalizado') return 'finalizado';
        return 'pendiente';
    }

    // Medidas del Figma 801:1076 (vectores del SVG 68:11939, frame de 1440px):
    // paradas Ø19.62, parada seleccionada Ø27.46, base Ø23.54 y la etiqueta
    // con la línea base 43px por debajo del centro de la base.
    const WIRE_STOP_RADIUS = 9.81;
    const WIRE_SELECTED_RADIUS = 13.73;
    const WIRE_BASE_RADIUS = 11.77;
    const WIRE_LABEL_OFFSET = 43;

    /**
     * SVG del globo wireframe. Devuelve { svg, points } con la posición en px
     * de cada parada (para los botones accesibles superpuestos). Orden de
     * pintado del Figma: retícula, base y etiqueta, rutas (la seleccionada
     * arriba, su primer medio trazo cae sobre la base) y paradas.
     */
    function buildWireframeSvg(route, selectedId, width, height) {
        const geometry = wireframeGeometry(width, height);
        const { cx, cy, radius } = geometry;
        const center = wireframeCenter(route);
        const r = (value) => value.toFixed(1);
        // Las medidas del Figma valen para el globo de 1440px (radio 391.7 en el panel de 960px);
        // en pantallas chicas los puntos y la etiqueta se achican con el globo.
        const k = clampNumber(radius / 391.7, 0.6, 1);
        const size = (value) => (value * k).toFixed(2);
        const wire = [
            `<circle class="tvg-wire" cx="${r(cx)}" cy="${r(cy)}" r="${r(radius)}"/>`,
            `<line class="tvg-wire" x1="${r(cx - radius)}" y1="${r(cy)}" x2="${r(cx + radius)}" y2="${r(cy)}"/>`,
            ...[0.35, 0.7].map((k) => `<ellipse class="tvg-wire" cx="${r(cx)}" cy="${r(cy)}" rx="${r(radius)}" ry="${r(radius * k)}"/>`),
            ...[0.35, 0.7].map((k) => `<ellipse class="tvg-wire" cx="${r(cx)}" cy="${r(cy)}" rx="${r(radius * k)}" ry="${r(radius)}"/>`),
        ];
        const baseVector = route?.base?.location ? orthoVector(route.base.location, center) : null;
        const basePoint = baseVector ? toScreen(baseVector, geometry) : null;
        const stops = route?.stops || [];
        const selected = String(selectedId || '');
        const points = new Map();
        const routes = [];
        const markers = [];
        let selectedRoute = '';
        let selectedMarker = '';
        stops.forEach((stop) => {
            const vector = orthoVector(stop.location, center);
            const point = toScreen(vector, geometry);
            points.set(String(stop.id), point);
            const tone = wireframeStatusClass(stop.status);
            const isSelected = String(stop.id) === selected;
            const back = point.front ? '' : ' is-back';
            const path = baseVector ? arcPath(baseVector, vector, geometry) : '';
            if (isSelected) {
                if (path) selectedRoute = `<path class="tvg-route tvg-route--selected" data-wire-stop="${escapeHtml(stop.id)}" d="${path}"/>`;
                selectedMarker = `<circle class="tvg-stop tvg-stop--selected" data-wire-stop="${escapeHtml(stop.id)}" cx="${r(point.x)}" cy="${r(point.y)}" r="${size(WIRE_SELECTED_RADIUS)}"/>`;
            } else {
                if (path) routes.push(`<path class="tvg-route tvg-route--${tone}${back}" data-wire-stop="${escapeHtml(stop.id)}" d="${path}"/>`);
                markers.push(`<circle class="tvg-stop tvg-stop--${tone}${back}" data-wire-stop="${escapeHtml(stop.id)}" cx="${r(point.x)}" cy="${r(point.y)}" r="${size(WIRE_STOP_RADIUS)}"/>`);
            }
        });
        const base = basePoint
            ? `<g class="tvg-basepoint"><circle class="tvg-base" cx="${r(basePoint.x)}" cy="${r(basePoint.y)}" r="${size(WIRE_BASE_RADIUS)}"/></g>`
            + `<text class="tvg-label" x="${r(basePoint.x)}" y="${r(basePoint.y + WIRE_LABEL_OFFSET * k)}">${escapeHtml(wireframeBaseLabel(route.base).toUpperCase())}</text>`
            : '';
        const svg = `<svg class="tvl-wire-svg" viewBox="0 0 ${r(geometry.width)} ${r(geometry.height)}" width="${r(geometry.width)}" height="${r(geometry.height)}" aria-hidden="true" focusable="false">
            <g class="tvg-wireframe">${wire.join('')}</g>
            ${base}
            <g class="tvg-routes">${routes.join('')}${selectedRoute}</g>
            <g class="tvg-stops">${markers.join('')}${selectedMarker}</g>
        </svg>`;
        return { svg, points, geometry };
    }

    class WeotziTravelGlobe extends BaseElement {
        constructor() {
            super();
            this._payload = null;
            this._route = null;
            this._navigator = null;
            this._controller = null;
            this._selectedId = null;
            this._renderToken = 0;
            this._wide = null;
            this._resizeObserver = null;
            this._boundClick = (event) => this._onClick(event);
        }

        connectedCallback() {
            this.setAttribute?.('role', 'region');
            this.setAttribute?.('aria-label', this.getAttribute?.('aria-label') || 'Globo interactivo de la ruta de viajes del artista');
            this.addEventListener?.('click', this._boundClick);
            if (typeof root.ResizeObserver === 'function') {
                this._resizeObserver = new root.ResizeObserver((entries) => {
                    const width = entries[0]?.contentRect?.width || this.clientWidth || 0;
                    const height = entries[0]?.contentRect?.height || this.clientHeight || 0;
                    const nextWide = width >= 700;
                    this.dataset.layout = nextWide ? 'wide' : 'compact';
                    if (this._isWireframe()) {
                        // El SVG se dibuja en px reales: se rehace si cambia el tamaño.
                        const size = this._wireSize;
                        if (this._payload && (!size || Math.abs(size[0] - width) > 1 || Math.abs(size[1] - height) > 1)) {
                            this._render();
                        }
                        return;
                    }
                    if (this._wide == null) this._wide = nextWide;
                    else if (nextWide !== this._wide) {
                        this._wide = nextWide;
                        this._render();
                    }
                });
                this._resizeObserver.observe(this);
            }
            if (this._payload) this._render();
        }

        disconnectedCallback() {
            this.removeEventListener?.('click', this._boundClick);
            this._resizeObserver?.disconnect?.();
            this._resizeObserver = null;
            this._destroyController();
        }

        setTravelData(payload) {
            this._payload = payload || {};
            if (payload?.selectedStopId != null) this._selectedId = String(payload.selectedStopId);
            if (this.isConnected !== false) this._render();
            return this;
        }

        get route() {
            return this._route;
        }

        get selectedId() {
            return this._selectedId;
        }

        set selectedId(value) {
            if (value != null) this.selectTrip(value, { emit: false });
        }

        selectTrip(id, options) {
            if (!this._navigator || id == null) return null;
            const stop = this._navigator.select(String(id));
            if (!stop || String(stop.id) !== String(id)) return null;
            const changed = this._selectedId !== String(stop.id);
            this._selectedId = String(stop.id);
            if (this._isWireframe() && changed) this._render();
            else this._renderInfo(stop);
            this._controller?.setSelectedStop?.(stop.id);
            if (options?.focus) {
                [...this.querySelectorAll('button[data-globe-stop]')]
                    .find((button) => button.getAttribute('data-globe-stop') === String(stop.id) && !button.hidden)?.focus();
            }
            if (options?.emit !== false) this._emit('travel-stop-select', { id: this._selectedId, stop });
            return stop;
        }

        previous() {
            const index = this._navigator?.selectedIndex ?? -1;
            const stop = index > 0 ? this._route.stops[index - 1] : null;
            return stop ? this.selectTrip(stop.id) : null;
        }

        next() {
            const index = this._navigator?.selectedIndex ?? -1;
            const stop = index >= 0 && index < (this._route?.stops?.length || 0) - 1
                ? this._route.stops[index + 1]
                : null;
            return stop ? this.selectTrip(stop.id) : null;
        }

        resetView() {
            this._controller?.resetView?.();
            const first = this._route?.stops?.[0];
            if (first) this.selectTrip(first.id);
        }

        pause() {
            this._controller?.pause?.('user');
            this.classList?.add('is-animation-paused');
        }

        resume() {
            this._controller?.resume?.('user');
            this.classList?.remove('is-animation-paused');
        }

        _emit(name, detail) {
            if (typeof root.CustomEvent !== 'function') return;
            this.dispatchEvent(new root.CustomEvent(name, { detail, bubbles: true }));
        }

        _destroyController() {
            this._renderToken += 1;
            this._controller?.destroy?.();
            this._controller = null;
        }

        _captureFocusKey() {
            const active = root.document?.activeElement;
            if (!active || !this.contains?.(active)) return null;
            const action = active.getAttribute?.('data-globe-act');
            if (action) return { type: 'action', value: action };
            const stop = active.getAttribute?.('data-globe-stop');
            if (!stop) return null;
            return {
                type: active.classList?.contains('tvl-cobe-hotspot') ? 'hotspot' : 'step',
                value: stop,
            };
        }

        _restoreFocusKey(key) {
            if (!key) return;
            let candidates = [];
            if (key.type === 'action') candidates = [...this.querySelectorAll('[data-globe-act]')];
            if (key.type === 'hotspot' || key.type === 'step') candidates = [...this.querySelectorAll('button[data-globe-stop]')];
            const attribute = key.type === 'action' ? 'data-globe-act' : 'data-globe-stop';
            candidates.find((node) => node.getAttribute(attribute) === key.value && !node.disabled)?.focus?.();
        }

        _setIconLabel(button, icon, label) {
            if (!button) return;
            button.innerHTML = `<i data-wo-icon="${escapeHtml(icon)}" aria-hidden="true"></i><span>${escapeHtml(label)}</span>`;
            root.WoIcons?.hydrate?.(button);
        }

        _isWireframe() {
            return this.getAttribute?.('mode') === 'wireframe';
        }

        _render() {
            const focusKey = this._captureFocusKey();
            const api = root.ArtistTravelCobe;
            if (!api || typeof api.buildTravelRoute !== 'function' || !this._payload) {
                this.innerHTML = '<p class="tvl-cobe-empty">El componente del globo no pudo cargar sus datos.</p>';
                this.dataset.renderer = 'unavailable';
                return;
            }
            if (this._isWireframe()) {
                this._renderWireframe(api, focusKey);
                return;
            }
            this._destroyController();
            this.classList?.remove('is-animation-paused');
            this._route = api.buildTravelRoute(this._payload);
            const currentWide = (this.clientWidth || root.innerWidth || 0) >= 700;
            this._wide = currentWide;
            this.dataset.layout = currentWide ? 'wide' : 'compact';
            const stops = this._route.stops || [];
            const hasSelected = stops.some((stop) => String(stop.id) === String(this._selectedId || ''));
            if (!hasSelected) {
                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const next = stops.find((stop) => {
                    const end = new Date(`${stop.endDate || stop.startDate}T00:00:00`);
                    return Number.isFinite(end.getTime()) && end >= now;
                }) || stops[0] || null;
                this._selectedId = next?.id ? String(next.id) : null;
            }
            this._navigator = api.createTravelRouteNavigator(stops, this._selectedId);
            const omitted = this._route.unresolvedCount || 0;
            this.dataset.globeMode = 'cobe';
            this.dataset.renderer = 'loading';
            // Figma final 801:1076: el globo solo muestra la ruta, las paradas,
            // la etiqueta de la base y la leyenda. Las paradas se recorren desde
            // la agenda y la cronología; el control de pausa existe para
            // teclado (WCAG 2.2.2) y solo se hace visible al recibir foco.
            const base = this._route.base || null;
            this.innerHTML = `
                <div class="tvl-cobe-fallback">${legacyFallback(this._route)}</div>
                <div class="tvl-cobe-stage">
                    <canvas class="tvl-cobe-canvas" aria-hidden="true" hidden></canvas>
                    ${base ? `<span class="tvl-cobe-base" aria-hidden="true" hidden>${escapeHtml(base.label)}</span>` : ''}
                    <div class="tvl-cobe-hotspots" aria-label="Paradas de la ruta">
                        ${stops.map((stop) => `<button type="button" class="tvl-cobe-hotspot tvl-cobe-hotspot--${escapeHtml(stop.status)}" data-globe-stop="${escapeHtml(stop.id)}" aria-label="Ver viaje a ${escapeHtml(stop.city)} · ${escapeHtml(shortDate(stop.startDate))} · ${escapeHtml(STATUS_LABELS[stop.status] || stop.status)}" hidden><span>${escapeHtml(stop.city)}</span></button>`).join('')}
                    </div>
                    <div class="tvl-cobe-legend" aria-hidden="true"><span><i class="tvl-dot tvl-dot--confirmado"></i>Confirmado</span><span><i class="tvl-dot tvl-dot--pendiente"></i>Pendiente</span><span><i class="tvl-dot tvl-dot--finalizado"></i>Finalizado</span></div>
                    <button type="button" class="tvl-cobe-playback" data-globe-act="pause" aria-pressed="false"><i data-wo-icon="pause" aria-hidden="true"></i><span>Pausar animación</span></button>
                    <p class="tvl-cobe-fallback-status" role="status" hidden></p>
                    ${omitted ? `<p class="tvl-cobe-omitted">${omitted} ${omitted === 1 ? 'parada no tiene' : 'paradas no tienen'} coordenadas verificables y no se muestra en el globo.</p>` : ''}
                </div>`;
            this._renderInfo(this._navigator.selectedStop);
            root.WoIcons?.hydrate?.(this);
            this._restoreFocusKey(focusKey);
            const token = ++this._renderToken;
            root.requestAnimationFrame?.(() => this._mountCobe(token));
        }

        // Sin selección explícita (agenda, cronología o ?parada=) se resalta la
        // próxima parada vigente; las finalizadas solo se resaltan si no hay
        // ningún viaje por delante.
        _ensureSelection(stops) {
            const hasSelected = stops.some((stop) => String(stop.id) === String(this._selectedId || ''));
            if (hasSelected) return;
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const next = stops.find((stop) => {
                if (wireframeStatusClass(stop.status) === 'finalizado') return false;
                const end = new Date(`${stop.endDate || stop.startDate}T00:00:00`);
                return Number.isFinite(end.getTime()) && end >= now;
            }) || stops[stops.length - 1] || null;
            this._selectedId = next?.id ? String(next.id) : null;
        }

        // Figma final 801:1076: globo wireframe estático (meridianos y
        // paralelos en --neutral-400), rutas desde la base y la parada
        // seleccionada (por defecto la próxima) en punteado amarillo. Las
        // paradas siguen siendo botones accesibles superpuestos al SVG.
        _renderWireframe(api, focusKey) {
            this._destroyController();
            this.classList?.remove('is-animation-paused');
            this._route = api.buildTravelRoute(this._payload);
            const measuredWidth = this.clientWidth || 0;
            const measuredHeight = this.clientHeight || 0;
            this._wireSize = [measuredWidth, measuredHeight];
            const width = measuredWidth || 960;
            const height = measuredHeight || 986;
            this._wide = width >= 700;
            this.dataset.layout = this._wide ? 'wide' : 'compact';
            const stops = this._route.stops || [];
            this._ensureSelection(stops);
            this._navigator = api.createTravelRouteNavigator(stops, this._selectedId);
            this.dataset.globeMode = 'wireframe';
            this.dataset.renderer = 'wireframe';
            const { svg, points } = buildWireframeSvg(this._route, this._selectedId, width, height);
            const omitted = this._route.unresolvedCount || 0;
            this.innerHTML = `
                <div class="tvl-wire-stage">
                    ${svg}
                    <div class="tvl-wire-hotspots" aria-label="Paradas de la ruta">
                        ${stops.map((stop) => {
                            const point = points.get(String(stop.id)) || { x: 0, y: 0 };
                            return `<button type="button" class="tvl-wire-hotspot" data-globe-stop="${escapeHtml(stop.id)}" style="left:${point.x.toFixed(1)}px;top:${point.y.toFixed(1)}px" aria-label="Ver viaje a ${escapeHtml(stop.city)} · ${escapeHtml(shortDate(stop.startDate))} · ${escapeHtml(STATUS_LABELS[stop.status] || stop.status)}"></button>`;
                        }).join('')}
                    </div>
                    <div class="tvl-cobe-legend" aria-hidden="true"><span><i class="tvl-dot tvl-dot--confirmado"></i>Confirmado</span><span><i class="tvl-dot tvl-dot--pendiente"></i>Pendiente</span><span><i class="tvl-dot tvl-dot--finalizado"></i>Finalizado</span></div>
                    ${omitted ? `<p class="tvl-cobe-omitted">${omitted} ${omitted === 1 ? 'parada no tiene' : 'paradas no tienen'} coordenadas verificables y no se muestra en el globo.</p>` : ''}
                </div>`;
            this._renderInfo(this._navigator.selectedStop);
            this._restoreFocusKey(focusKey);
            this._emit('travel-globe-modechange', { mode: 'wireframe' });
        }

        async _mountCobe(token) {
            if (token !== this._renderToken || !this.isConnected) return;
            const canvas = this.querySelector('.tvl-cobe-canvas');
            const fallback = this.querySelector('.tvl-cobe-fallback');
            const status = this.querySelector('.tvl-cobe-fallback-status');
            if (!canvas || !fallback || !status) return;
            try {
                const cobeModule = await import('/shared/vendor/cobe/index.esm.js');
                if (token !== this._renderToken || !canvas.isConnected) return;
                canvas.hidden = false;
                const probe = root.document.createElement('canvas');
                let webglAvailable = false;
                try { webglAvailable = Boolean(probe.getContext('webgl2') || probe.getContext('webgl')); } catch (error) { webglAvailable = false; }
                const reducedMotion = root.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
                const cssPixels = Math.max(1, canvas.clientWidth * canvas.clientHeight);
                const dpr = Math.max(1, Math.min(root.devicePixelRatio || 1, 2, Math.sqrt(2500000 / cssPixels)));
                const wide = (this.clientWidth || 0) >= 700;
                this._wide = wide;
                this.dataset.layout = wide ? 'wide' : 'compact';
                this._controller = root.ArtistTravelCobe.mountTravelGlobe({
                    canvas,
                    fallbackElement: status,
                    route: this._route,
                    createGlobe: webglAvailable ? cobeModule.default : () => null,
                    reducedMotion,
                    ResizeObserver: root.ResizeObserver,
                    IntersectionObserver: root.IntersectionObserver,
                    document: root.document,
                    requestAnimationFrame: root.requestAnimationFrame.bind(root),
                    cancelAnimationFrame: root.cancelAnimationFrame.bind(root),
                    devicePixelRatio: dpr,
                    phi: -1.28,
                    theta: -0.12,
                    scale: wide ? 0.92 : 0.94,
                    offset: [0, 0],
                    rotationSpeed: 0.00055,
                    flightDurationMs: 4800,
                    stopDwellMs: 700,
                    arcWidth: 0.55,
                    baseColor: [0.34, 0.23, 0.07],
                    glowColor: [0.34, 0.22, 0.05],
                    diffuse: 1.8,
                    mapBrightness: 4.8,
                    selectedStopId: this._selectedId,
                    onRender: (state) => this._renderFrame(state),
                    onModeChange: (mode, error) => {
                        this._setMode(mode, fallback, reducedMotion);
                        if (error) console.warn('[travel-globe] modo alternativo:', error);
                    },
                    onContextLost: () => this._setMode('fallback', fallback, reducedMotion),
                });
                if (token !== this._renderToken) {
                    this._controller?.destroy?.();
                    this._controller = null;
                    return;
                }
                this._setMode(this._controller?.mode === 'webgl' ? 'webgl' : 'fallback', fallback, reducedMotion);
                this._controller?.setSelectedStop?.(this._selectedId);
            } catch (error) {
                canvas.hidden = true;
                fallback.hidden = false;
                status.hidden = false;
                status.textContent = 'El globo interactivo no está disponible. Podés consultar las paradas de la ruta.';
                this.dataset.renderer = 'svg';
                this._setPlaybackAvailability(false, false);
                console.warn('[travel-globe] COBE no pudo iniciar:', error);
            }
        }

        _setMode(mode, fallback, reducedMotion) {
            const webgl = mode === 'webgl';
            fallback.hidden = webgl;
            this.dataset.renderer = webgl ? 'cobe' : 'svg';
            this._setPlaybackAvailability(webgl, reducedMotion);
            this._emit('travel-globe-modechange', { mode: this.dataset.renderer });
        }

        _setPlaybackAvailability(webgl, reducedMotion) {
            const button = this.querySelector('[data-globe-act="pause"]');
            if (!button) return;
            button.disabled = !webgl || reducedMotion;
            this._setIconLabel(
                button,
                webgl && !reducedMotion ? 'pause' : 'slash',
                !webgl ? 'Vista estática' : reducedMotion ? 'Movimiento reducido' : 'Pausar animación'
            );
        }

        // Sin tarjeta de destino (Figma final): la selección solo resalta la
        // parada en el globo; la agenda y la cronología reflejan el mismo id.
        _renderInfo(stop) {
            const selectedId = stop ? String(stop.id) : '';
            this.querySelectorAll?.('[data-globe-stop]').forEach((button) => {
                const selected = String(button.getAttribute('data-globe-stop')) === selectedId;
                button.classList.toggle('is-selected', selected);
                if (selected) button.setAttribute('aria-current', 'true');
                else button.removeAttribute('aria-current');
            });
        }

        _renderFrame(state) {
            if (!state) return;
            const baseLabel = this.querySelector('.tvl-cobe-base');
            const base = state.route?.base || this._route?.base || null;
            if (baseLabel && base?.location) {
                const point = root.ArtistTravelCobe.projectTravelLocation(base.location, state);
                baseLabel.hidden = !point.visible;
                if (point.visible) baseLabel.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
            }
            const byId = new Map((state.route?.stops || []).map((stop) => [String(stop.id), stop]));
            this.querySelectorAll('.tvl-cobe-hotspot[data-globe-stop]').forEach((button) => {
                const stop = byId.get(String(button.getAttribute('data-globe-stop')));
                if (!stop) { button.hidden = true; return; }
                const point = root.ArtistTravelCobe.projectTravelLocation(stop.location, state);
                button.hidden = !point.visible;
                if (!point.visible) return;
                button.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
                button.style.zIndex = String(Math.max(2, Math.round(20 + point.depth * 10)));
            });
        }

        _onClick(event) {
            const stopButton = event.target.closest?.('[data-globe-stop]');
            if (stopButton) {
                const stop = this.selectTrip(stopButton.getAttribute('data-globe-stop'));
                if (stop) this._emit('travel-view-trip', { id: String(stop.id), stop });
                return;
            }
            const button = event.target.closest?.('[data-globe-act]');
            const action = button?.getAttribute('data-globe-act');
            if (!action) return;
            if (action === 'pause') {
                const paused = button.getAttribute('aria-pressed') !== 'true';
                button.setAttribute('aria-pressed', String(paused));
                this._setIconLabel(button, paused ? 'play' : 'pause', paused ? 'Reanudar animación' : 'Pausar animación');
                if (paused) this.pause(); else this.resume();
            }
        }
    }

    function defineTravelGlobeElement(targetRoot) {
        const registry = targetRoot?.customElements;
        if (!registry || registry.get(tagName)) return false;
        registry.define(tagName, WeotziTravelGlobe);
        return true;
    }

    return {
        tagName,
        WeotziTravelGlobe,
        defineTravelGlobeElement,
        abbreviateBaseCity,
        wireframeBaseLabel,
        buildWireframeSvg,
    };
}));
