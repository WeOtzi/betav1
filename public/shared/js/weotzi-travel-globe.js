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
                    const nextWide = width >= 700;
                    this.dataset.layout = nextWide ? 'wide' : 'compact';
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
            this._selectedId = String(stop.id);
            this._renderInfo(stop);
            this._controller?.setSelectedStop?.(stop.id);
            if (options?.focus) {
                [...this.querySelectorAll('.tvl-cobe-step[data-globe-stop]')]
                    .find((button) => button.getAttribute('data-globe-stop') === String(stop.id))?.focus();
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
            if (key.type === 'step') candidates = [...this.querySelectorAll('.tvl-cobe-step[data-globe-stop]')];
            if (key.type === 'hotspot') candidates = [...this.querySelectorAll('.tvl-cobe-hotspot[data-globe-stop]')];
            const attribute = key.type === 'action' ? 'data-globe-act' : 'data-globe-stop';
            candidates.find((node) => node.getAttribute(attribute) === key.value && !node.disabled)?.focus?.();
        }

        _setIconLabel(button, icon, label) {
            if (!button) return;
            button.innerHTML = `<i data-wo-icon="${escapeHtml(icon)}" aria-hidden="true"></i><span>${escapeHtml(label)}</span>`;
            root.WoIcons?.hydrate?.(button);
        }

        _render() {
            const focusKey = this._captureFocusKey();
            const api = root.ArtistTravelCobe;
            if (!api || typeof api.buildTravelRoute !== 'function' || !this._payload) {
                this.innerHTML = '<p class="tvl-cobe-empty">El componente del globo no pudo cargar sus datos.</p>';
                this.dataset.renderer = 'unavailable';
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
            this.innerHTML = `
                <div class="tvl-cobe-fallback">${legacyFallback(this._route)}</div>
                <div class="tvl-cobe-stage">
                    <canvas class="tvl-cobe-canvas" aria-hidden="true" hidden></canvas>
                    <span class="tvl-cobe-plane" aria-hidden="true"><i data-wo-icon="navigation"></i></span>
                    <div class="tvl-cobe-hotspots" aria-label="Puntos de información de la ruta">
                        ${stops.map((stop) => `<button type="button" class="tvl-cobe-hotspot tvl-cobe-hotspot--${escapeHtml(stop.status)}" data-globe-stop="${escapeHtml(stop.id)}" aria-label="Ver información de ${escapeHtml(stop.city)}" hidden><span>${escapeHtml(stop.city)}</span></button>`).join('')}
                    </div>
                    <div class="tvl-cobe-controls" aria-label="Controles del recorrido">
                        <button type="button" class="tvl-cobe-control" data-globe-act="previous" aria-label="Parada anterior"><i data-wo-icon="arrow-up" aria-hidden="true"></i></button>
                        <span class="tvl-cobe-count" aria-live="polite">—</span>
                        <button type="button" class="tvl-cobe-control" data-globe-act="next" aria-label="Parada siguiente"><i data-wo-icon="arrow-down" aria-hidden="true"></i></button>
                    </div>
                    <button type="button" class="tvl-cobe-reset" data-globe-act="reset"><i data-wo-icon="rotate-ccw" aria-hidden="true"></i><span>Reiniciar vista</span></button>
                    <div class="tvl-cobe-legend" aria-hidden="true"><span><i class="tvl-dot tvl-dot--confirmado"></i>Confirmado</span><span><i class="tvl-dot tvl-dot--pendiente"></i>Pendiente</span><span><i class="tvl-dot tvl-dot--finalizado"></i>Finalizado</span></div>
                    <article class="tvl-cobe-info" aria-live="polite"></article>
                    <nav class="tvl-cobe-stepper" aria-label="Paradas de la ruta">
                        ${stops.map((stop) => `<button type="button" class="tvl-cobe-step tvl-cobe-step--${escapeHtml(stop.status)}" data-globe-stop="${escapeHtml(stop.id)}"><span>${escapeHtml(shortDate(stop.startDate))}</span><strong>${escapeHtml(stop.city)}</strong><small>${escapeHtml(STATUS_LABELS[stop.status] || stop.status)}</small></button>`).join('')}
                    </nav>
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
                    scale: wide ? 0.82 : 0.9,
                    offset: wide ? [-Math.round(canvas.clientWidth * 0.16), 0] : [0, -28],
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

        _renderInfo(stop) {
            const panel = this.querySelector?.('.tvl-cobe-info');
            if (!panel) return;
            // The destination card is part of the globe composition, not a
            // secondary scroll surface. Let it grow to its full content on
            // every stop change even if a consumer ships older CSS.
            panel.style.maxHeight = 'none';
            panel.style.overflow = 'visible';
            if (!stop) {
                panel.innerHTML = '<p class="tvl-cobe-empty">No hay paradas con coordenadas verificables para estos filtros.</p>';
                const count = this.querySelector('.tvl-cobe-count');
                if (count) count.textContent = '0 / 0';
                return;
            }
            const venueLabel = stop.trip?.trip_type === 'convencion' ? 'Lugar' : 'Estudio';
            panel.innerHTML = `<p class="tvl-cobe-kicker">Destino seleccionado</p>
                <header class="tvl-cobe-info-head"><span class="tvl-cobe-status-dot tvl-cobe-status-dot--${escapeHtml(stop.status)}" aria-hidden="true"></span><h2>${escapeHtml(stop.city)}, <span>${escapeHtml(stop.country)}</span></h2><span class="tvl-cobe-tag">${escapeHtml(STATUS_LABELS[stop.status] || stop.status)}</span></header>
                <dl class="tvl-cobe-details"><div><dt>Fechas</dt><dd>${escapeHtml(shortDate(stop.startDate))} – ${escapeHtml(shortDate(stop.endDate))}</dd></div><div><dt>${venueLabel}</dt><dd>${escapeHtml(stop.studioName || (venueLabel === 'Lugar' ? 'Lugar por confirmar' : 'Sin estudio vinculado'))}</dd></div><div><dt>Dirección</dt><dd>${escapeHtml(stop.address || `${stop.city}, ${stop.country}`)}</dd></div><div><dt>Resumen</dt><dd>${escapeHtml(stop.summary || 'Sin notas adicionales para esta parada.')}</dd></div></dl>
                <footer><span>ID: ${escapeHtml(String(stop.id).slice(0, 18))}</span><button type="button" class="tvl-cobe-view" data-globe-act="view"><span>Ver viaje</span><i data-wo-icon="arrow-right" aria-hidden="true"></i></button></footer>`;
            root.WoIcons?.hydrate?.(panel);
            const count = this.querySelector('.tvl-cobe-count');
            if (count) count.textContent = `${String((this._navigator?.selectedIndex ?? 0) + 1).padStart(2, '0')} / ${String(this._route?.stops?.length || 0).padStart(2, '0')}`;
            this.querySelectorAll('[data-globe-stop]').forEach((button) => {
                const selected = String(button.getAttribute('data-globe-stop')) === String(stop.id);
                button.classList.toggle('is-selected', selected);
                button.setAttribute('aria-pressed', String(selected));
            });
            const index = this._navigator?.selectedIndex ?? -1;
            const previous = this.querySelector('[data-globe-act="previous"]');
            const next = this.querySelector('[data-globe-act="next"]');
            if (previous) previous.disabled = index <= 0;
            if (next) next.disabled = index < 0 || index >= (this._route?.stops?.length || 0) - 1;
        }

        _renderFrame(state) {
            if (!state) return;
            const plane = this.querySelector('.tvl-cobe-plane');
            const position = state.plane?.position;
            if (plane) {
                plane.hidden = !position?.visible;
                if (position?.visible) plane.style.transform = `translate3d(${position.x}px, ${position.y}px, 0) rotate(${state.plane.heading}deg)`;
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
                this.selectTrip(stopButton.getAttribute('data-globe-stop'));
                return;
            }
            const button = event.target.closest?.('[data-globe-act]');
            const action = button?.getAttribute('data-globe-act');
            if (!action) return;
            if (action === 'previous') this.previous();
            if (action === 'next') this.next();
            if (action === 'reset') this.resetView();
            if (action === 'view' && this._selectedId) this._emit('travel-view-trip', { id: this._selectedId, stop: this._navigator?.selectedStop || null });
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

    return { tagName, WeotziTravelGlobe, defineTravelGlobeElement };
}));
