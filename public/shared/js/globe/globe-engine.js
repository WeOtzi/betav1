/**
 * GLOBE ENGINE — Three.js WebGPU + TSL
 *
 * Motor 3D del globo de WeOtzi (/explore/globe). Renderiza una tierra
 * nocturna realista (luces de ciudad NASA + atmósfera fresnel + estrellas),
 * marcadores instanciados para el roster, arcos de itinerario animados y un
 * avión que recorre las paradas con cámara cinematográfica.
 *
 * WebGPU donde esté disponible; fallback automático a WebGL2 (los node
 * materials TSL compilan a WGSL o GLSL según el backend).
 *
 * API (ver globe-app.js para el uso):
 *   const engine = new GlobeEngine(container);
 *   await engine.init();
 *   engine.setMarkers([{ id, lat, lng, kind: 'artist'|'studio' }]);
 *   engine.onPick(id => ...); engine.onHover(id => ...);
 *   engine.select(id); engine.highlight([ids]); engine.setDimmed(idSet);
 *   await engine.focusOn(lat, lng, { distance, duration });
 *   const tour = engine.playTour(stops, { onArrive });  tour.cancel();
 */

import * as THREE from 'three/webgpu';
import {
    texture, color, uniform, float, vec3, vec4, uv,
    positionWorld, normalWorld, cameraPosition,
    mix, smoothstep, pow, saturate, oneMinus, step, normalMap
} from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EARTH_RADIUS = 1;
const MARKER_RADIUS = 1.012;
const ARC_RADIUS = 1.02;

const COLORS = {
    artist: new THREE.Color('#ffb703'),
    studio: new THREE.Color('#4cc9f0'),
    selected: new THREE.Color('#ffffff'),
    arcA: new THREE.Color('#ffb703'),
    arcB: new THREE.Color('#ff5d8f'),
    atmosphere: new THREE.Color('#3a7bd5')
};

function latLngToVec3(lat, lng, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);
    return new THREE.Vector3(
        -radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
    );
}

function vec3ToLatLng(v) {
    const r = v.length();
    const lat = 90 - (Math.acos(v.y / r) * 180 / Math.PI);
    const lng = ((Math.atan2(v.z, -v.x) * 180 / Math.PI) - 180);
    return { lat, lng: ((lng + 540) % 360) - 180 };
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class GlobeEngine {
    constructor(container, opts = {}) {
        this.container = container;
        this.reducedMotion = opts.reducedMotion
            ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.markers = [];
        this._markerIndex = new Map();   // id -> índice de instancia
        this._pickCb = null;
        this._hoverCb = null;
        this._dimmedSet = null;
        this._selectedId = null;
        this._highlightRings = [];
        this._arcs = [];
        this._tour = null;
        this._cameraTween = null;
        this._lastInteraction = 0;
        this._disposed = false;
    }

    async init() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;

        this.renderer = new THREE.WebGPURenderer({
            antialias: true,
            forceWebGL: !navigator.gpu
        });
        await this.renderer.init();
        this.backend = navigator.gpu ? 'webgpu' : 'webgl2';
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(w, h);
        this.renderer.domElement.classList.add('globe-canvas');
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 120);
        this.camera.position.set(0, 0.55, 3.1);

        // Luz: la noche vive del emissive; una direccional fría da volumen
        this.scene.add(new THREE.AmbientLight(0x223044, 0.55));
        const moon = new THREE.DirectionalLight(0x9db8ff, 0.85);
        moon.position.set(-4, 2.5, 3);
        this.scene.add(moon);

        await this._buildEarth();
        this._buildAtmosphere();
        this._buildStars();
        this._buildMarkerMesh();
        this._buildSelectionRing();
        this._buildPlane();

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enablePan = false;
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.rotateSpeed = 0.45;
        this.controls.minDistance = 1.6;
        this.controls.maxDistance = 5.5;
        this.controls.autoRotate = !this.reducedMotion;
        this.controls.autoRotateSpeed = 0.35;
        this.controls.addEventListener('start', () => {
            this._lastInteraction = performance.now();
            this.controls.autoRotate = false;
        });

        this._bindPointer();
        this._t0 = performance.now();
        this.renderer.setAnimationLoop(() => this._tick());

        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize);
        document.addEventListener('visibilitychange', () => {
            if (this._disposed) return;
            this.renderer.setAnimationLoop(document.hidden ? null : () => this._tick());
        });
    }

    // ---------------------------------------------------------------
    // Construcción de la escena
    // ---------------------------------------------------------------
    async _loadTexture(url, srgb) {
        const tex = await new THREE.TextureLoader().loadAsync(url);
        if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        return tex;
    }

    async _buildEarth() {
        const base = '/shared/img/globe/';
        const [atmosMap, lightsMap, normalTex, specMap] = await Promise.all([
            this._loadTexture(base + 'earth_atmos_2048.jpg', true),
            this._loadTexture(base + 'earth_lights_2048.png', true),
            this._loadTexture(base + 'earth_normal_2048.jpg', false),
            this._loadTexture(base + 'earth_specular_2048.jpg', false)
        ]);

        const mat = new THREE.MeshStandardNodeMaterial();
        const viewDir = cameraPosition.sub(positionWorld).normalize();
        const fresnel = oneMinus(saturate(normalWorld.dot(viewDir)));

        // Base: el mapa diurno muy atenuado y enfriado = noche con relieve
        mat.colorNode = texture(atmosMap).rgb.mul(vec3(0.14, 0.18, 0.26));
        // Luces de ciudad cálidas + rim interior azulado
        mat.emissiveNode = texture(lightsMap).rgb
            .mul(vec3(1.0, 0.72, 0.42)).mul(1.45)
            .add(COLORS.atmosphere.clone().multiplyScalar(0)) // placeholder mantiene tipo
            .add(vec3(0.10, 0.22, 0.38).mul(pow(fresnel, float(3.0))));
        mat.roughnessNode = oneMinus(texture(specMap).r.mul(0.55));
        mat.metalnessNode = float(0.0);
        mat.normalNode = normalMap(texture(normalTex), float(0.55));

        // SphereGeometry sin rotar: el mapeo equirectangular estándar ya
        // coincide con latLngToVec3 (θ = lng + 180).
        this.earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 96, 96), mat);
        this.scene.add(this.earth);
    }

    _buildAtmosphere() {
        const mat = new THREE.MeshBasicNodeMaterial();
        const viewDir = cameraPosition.sub(positionWorld).normalize();
        // Shell BackSide: el halo crece hacia el limbo
        const rim = saturate(normalWorld.dot(viewDir).add(1.0).mul(0.5));
        const intensity = pow(rim, float(5.0)).mul(1.15);
        mat.colorNode = vec3(0.23, 0.49, 0.84);
        mat.opacityNode = intensity;
        mat.transparent = true;
        mat.blending = THREE.AdditiveBlending;
        mat.side = THREE.BackSide;
        mat.depthWrite = false;

        const shell = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS * 1.05, 64, 64), mat);
        this.scene.add(shell);
    }

    _buildStars() {
        const COUNT = 2600;
        const positions = new Float32Array(COUNT * 3);
        const colors = new Float32Array(COUNT * 3);
        for (let i = 0; i < COUNT; i++) {
            // Esfera hueca lejana
            const r = 28 + Math.random() * 36;
            const t = Math.random() * Math.PI * 2;
            const p = Math.acos(2 * Math.random() - 1);
            positions[i * 3] = r * Math.sin(p) * Math.cos(t);
            positions[i * 3 + 1] = r * Math.cos(p);
            positions[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
            const tone = 0.55 + Math.random() * 0.45;
            const warm = Math.random() < 0.18;
            colors[i * 3] = tone * (warm ? 1.0 : 0.82);
            colors[i * 3 + 1] = tone * (warm ? 0.85 : 0.88);
            colors[i * 3 + 2] = tone;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const mat = new THREE.PointsMaterial({
            size: 0.08, sizeAttenuation: true, vertexColors: true,
            transparent: true, opacity: 0.85, depthWrite: false
        });
        this.scene.add(new THREE.Points(geo, mat));
    }

    _buildMarkerMesh() {
        const geo = new THREE.SphereGeometry(0.009, 10, 10);
        const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
        this.markerMesh = new THREE.InstancedMesh(geo, mat, 1024);
        this.markerMesh.count = 0;
        this.markerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.markerMesh);
    }

    _buildSelectionRing() {
        const geo = new THREE.RingGeometry(0.016, 0.02, 40);
        const mat = new THREE.MeshBasicMaterial({
            color: COLORS.selected, transparent: true, opacity: 0.9,
            side: THREE.DoubleSide, depthWrite: false, toneMapped: false
        });
        this.selectionRing = new THREE.Mesh(geo, mat);
        this.selectionRing.visible = false;
        this.scene.add(this.selectionRing);
    }

    _buildPlane() {
        // Avión de papel estilizado: 4 triángulos
        const geo = new THREE.BufferGeometry();
        const s = 0.045;
        const verts = new Float32Array([
            //  nariz            ala izq            cola centro
            0, 0, s * 1.6, -s, 0, -s, 0, s * 0.35, -s * 0.7,
            0, 0, s * 1.6, 0, s * 0.35, -s * 0.7, s, 0, -s,
            0, 0, s * 1.6, -s, 0, -s, s, 0, -s,
            -s, 0, -s, 0, s * 0.35, -s * 0.7, s, 0, -s
        ]);
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        geo.computeVertexNormals();
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.95,
            side: THREE.DoubleSide, toneMapped: false
        });
        this.plane = new THREE.Mesh(geo, mat);
        this.plane.visible = false;
        this.scene.add(this.plane);
    }

    // ---------------------------------------------------------------
    // Marcadores
    // ---------------------------------------------------------------
    setMarkers(list) {
        this.markers = list.filter(m => Number.isFinite(m.lat) && Number.isFinite(m.lng));
        this._markerIndex.clear();
        const dummy = new THREE.Object3D();
        const n = Math.min(this.markers.length, 1024);
        this.markerMesh.count = n;
        for (let i = 0; i < n; i++) {
            const m = this.markers[i];
            m._pos = latLngToVec3(m.lat, m.lng, MARKER_RADIUS);
            dummy.position.copy(m._pos);
            dummy.updateMatrix();
            this.markerMesh.setMatrixAt(i, dummy.matrix);
            this.markerMesh.setColorAt(i, COLORS[m.kind] || COLORS.artist);
            this._markerIndex.set(m.id, i);
        }
        this.markerMesh.instanceMatrix.needsUpdate = true;
        if (this.markerMesh.instanceColor) this.markerMesh.instanceColor.needsUpdate = true;
    }

    setDimmed(idSet) {
        this._dimmedSet = idSet || null;
        const dim = new THREE.Color('#2c3140');
        for (let i = 0; i < this.markerMesh.count; i++) {
            const m = this.markers[i];
            const dimmed = this._dimmedSet && !this._dimmedSet.has(m.id);
            this.markerMesh.setColorAt(i, dimmed ? dim : (COLORS[m.kind] || COLORS.artist));
        }
        if (this.markerMesh.instanceColor) this.markerMesh.instanceColor.needsUpdate = true;
    }

    highlight(ids) {
        // Anillos estáticos (p.ej. todas las sedes de un estudio)
        this._highlightRings.forEach(r => { this.scene.remove(r); r.geometry.dispose(); });
        this._highlightRings = [];
        (ids || []).forEach(id => {
            const i = this._markerIndex.get(id);
            if (i == null) return;
            const m = this.markers[i];
            const geo = new THREE.RingGeometry(0.013, 0.0165, 36);
            const mat = new THREE.MeshBasicMaterial({
                color: COLORS.studio, transparent: true, opacity: 0.85,
                side: THREE.DoubleSide, depthWrite: false, toneMapped: false
            });
            const ring = new THREE.Mesh(geo, mat);
            this._placeTangent(ring, m._pos);
            this.scene.add(ring);
            this._highlightRings.push(ring);
        });
    }

    select(id) {
        this._selectedId = id;
        if (!id) { this.selectionRing.visible = false; return; }
        const i = this._markerIndex.get(id);
        if (i == null) { this.selectionRing.visible = false; return; }
        this._placeTangent(this.selectionRing, this.markers[i]._pos);
        this.selectionRing.visible = true;
        this.controls.autoRotate = false;
    }

    _placeTangent(mesh, pos) {
        mesh.position.copy(pos).multiplyScalar(1.002);
        mesh.lookAt(pos.clone().multiplyScalar(2));
    }

    // ---------------------------------------------------------------
    // Picking / hover
    // ---------------------------------------------------------------
    onPick(cb) { this._pickCb = cb; }
    onHover(cb) { this._hoverCb = cb; }

    _bindPointer() {
        const el = this.renderer.domElement;
        this._raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        let downAt = null;

        const markerAt = (ev) => {
            const rect = el.getBoundingClientRect();
            ndc.set(
                ((ev.clientX - rect.left) / rect.width) * 2 - 1,
                -((ev.clientY - rect.top) / rect.height) * 2 + 1
            );
            this._raycaster.setFromCamera(ndc, this.camera);
            const hit = this._raycaster.intersectObject(this.earth, false)[0];
            if (!hit) return null;
            const p = hit.point.clone().normalize().multiplyScalar(MARKER_RADIUS);
            // Umbral angular dependiente del zoom (más cerca = más fino)
            const dist = this.camera.position.length();
            const threshold = 0.018 * dist;
            let best = null, bestD = threshold;
            for (const m of this.markers) {
                if (this._dimmedSet && !this._dimmedSet.has(m.id)) continue;
                const d = m._pos.distanceTo(p);
                if (d < bestD) { bestD = d; best = m; }
            }
            return best;
        };

        el.addEventListener('pointerdown', (ev) => {
            downAt = { x: ev.clientX, y: ev.clientY };
        });
        el.addEventListener('pointerup', (ev) => {
            if (!downAt) return;
            const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
            downAt = null;
            if (moved > 6 || this._tour) return;
            const m = markerAt(ev);
            if (this._pickCb) this._pickCb(m ? m.id : null);
        });

        let hoverPending = false;
        el.addEventListener('pointermove', (ev) => {
            if (hoverPending || this._tour || ev.pointerType === 'touch') return;
            hoverPending = true;
            requestAnimationFrame(() => {
                hoverPending = false;
                const m = markerAt(ev);
                el.style.cursor = m ? 'pointer' : 'grab';
                if (this._hoverCb) this._hoverCb(m ? m.id : null, ev.clientX, ev.clientY);
            });
        });
    }

    // ---------------------------------------------------------------
    // Cámara
    // ---------------------------------------------------------------
    focusOn(lat, lng, opts = {}) {
        const distance = opts.distance ?? 2.35;
        const duration = this.reducedMotion ? 0 : (opts.duration ?? 1100);
        const target = latLngToVec3(lat, lng, 1).normalize().multiplyScalar(distance);
        return this._tweenCameraTo(target, duration);
    }

    _tweenCameraTo(targetPos, duration) {
        if (this._cameraTween) this._cameraTween.cancel();
        if (duration <= 0) {
            this.camera.position.copy(targetPos);
            return Promise.resolve();
        }
        const startPos = this.camera.position.clone();
        const startR = startPos.length();
        const endR = targetPos.length();
        const a = startPos.clone().normalize();
        const b = targetPos.clone().normalize();
        const q0 = new THREE.Quaternion();
        const q1 = new THREE.Quaternion().setFromUnitVectors(a, b);
        const t0 = performance.now();
        return new Promise((resolve) => {
            const tween = { cancelled: false, cancel() { this.cancelled = true; resolve(); } };
            this._cameraTween = tween;
            const step = () => {
                if (tween.cancelled || this._disposed) return;
                const t = Math.min(1, (performance.now() - t0) / duration);
                const e = easeInOutCubic(t);
                const q = q0.clone().slerp(q1, e);
                const r = startR + (endR - startR) * e;
                this.camera.position.copy(a).applyQuaternion(q).multiplyScalar(r);
                this.camera.lookAt(0, 0, 0);
                if (t < 1) requestAnimationFrame(step);
                else { this._cameraTween = null; resolve(); }
            };
            requestAnimationFrame(step);
        });
    }

    setAutoRotate(on) { this.controls.autoRotate = on && !this.reducedMotion; }

    // ---------------------------------------------------------------
    // Itinerario: arcos + avión + tour
    // ---------------------------------------------------------------
    _buildArc(fromLatLng, toLatLng) {
        const p0 = latLngToVec3(fromLatLng.lat, fromLatLng.lng, ARC_RADIUS);
        const p1 = latLngToVec3(toLatLng.lat, toLatLng.lng, ARC_RADIUS);
        const angle = p0.angleTo(p1);
        const lift = ARC_RADIUS + 0.10 + angle * 0.22;
        const mid = p0.clone().add(p1).normalize().multiplyScalar(lift);
        const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);

        const progress = uniform(0);
        const mat = new THREE.MeshBasicNodeMaterial();
        const along = uv().x;
        mat.colorNode = mix(
            vec3(COLORS.arcA.r, COLORS.arcA.g, COLORS.arcA.b),
            vec3(COLORS.arcB.r, COLORS.arcB.g, COLORS.arcB.b),
            along
        );
        // Visible solo hasta el frente de avance, con una cola que se desvanece
        const drawn = oneMinus(step(progress, along));               // 1 si along <= progress
        const tail = smoothstep(progress.sub(0.55), progress, along) // brillo hacia el frente
            .mul(0.75).add(0.25);
        mat.opacityNode = drawn.mul(tail);
        mat.transparent = true;
        mat.depthWrite = false;
        mat.blending = THREE.AdditiveBlending;
        mat.toneMapped = false;

        const geo = new THREE.TubeGeometry(curve, 72, 0.0034, 6, false);
        const mesh = new THREE.Mesh(geo, mat);
        this.scene.add(mesh);
        const arc = { curve, mesh, progress };
        this._arcs.push(arc);
        return arc;
    }

    clearItinerary() {
        this._arcs.forEach(a => { this.scene.remove(a.mesh); a.mesh.geometry.dispose(); });
        this._arcs = [];
        this.plane.visible = false;
        if (this._tour) { this._tour.cancelled = true; this._tour = null; }
    }

    /**
     * Recorre las paradas en orden con el avión. `stops` = [{lat,lng,...}].
     * hooks.onArrive(stop, index) puede devolver una Promise — el tour espera
     * a que resuelva antes de despegar hacia la siguiente parada.
     * Devuelve un controlador { cancel, skip }.
     */
    playTour(stops, hooks = {}) {
        this.clearItinerary();
        const tour = { cancelled: false, _skip: null };
        tour.cancel = () => { tour.cancelled = true; if (tour._skip) tour._skip(); };
        tour.skip = () => { if (tour._skip) tour._skip(); };
        this._tour = tour;
        this.controls.enabled = false;
        this.controls.autoRotate = false;

        const run = async () => {
            try {
                // Posicionarse sobre la primera parada
                await this.focusOn(stops[0].lat, stops[0].lng, { distance: 2.6, duration: 1300 });
                if (tour.cancelled) return;
                if (hooks.onArrive) await hooks.onArrive(stops[0], 0);

                for (let i = 1; i < stops.length; i++) {
                    if (tour.cancelled) return;
                    const from = stops[i - 1], to = stops[i];
                    const arc = this._buildArc(from, to);
                    if (hooks.onDepart) hooks.onDepart(from, i - 1);
                    await this._flyLeg(arc, tour);
                    if (tour.cancelled) return;
                    // Re-encuadre: centrar la ciudad de llegada antes de la tarjeta
                    await this.focusOn(to.lat, to.lng, { distance: 2.45, duration: 700 });
                    if (tour.cancelled) return;
                    if (hooks.onArrive) await hooks.onArrive(to, i);
                }
                if (hooks.onEnd && !tour.cancelled) hooks.onEnd();
            } finally {
                this.plane.visible = false;
                this.controls.enabled = true;
                if (this._tour === tour) this._tour = null;
            }
        };
        tour.done = run();
        return tour;
    }

    _flyLeg(arc, tour) {
        const length = arc.curve.getLength();
        const duration = this.reducedMotion
            ? 0
            : Math.min(4200, Math.max(1700, length * 2400));
        if (duration === 0) {
            arc.progress.value = 1;
            const end = arc.curve.getPointAt(1);
            const ll = vec3ToLatLng(end);
            return this.focusOn(ll.lat, ll.lng, { distance: 2.6, duration: 0 });
        }
        this.plane.visible = true;
        const t0 = performance.now();
        const up = new THREE.Vector3();
        const ahead = new THREE.Vector3();
        return new Promise((resolve) => {
            tour._skip = () => { tour._skip = null; resolve(); };
            const step = () => {
                if (tour.cancelled || this._disposed) { tour._skip = null; return resolve(); }
                const t = Math.min(1, (performance.now() - t0) / duration);
                const e = easeInOutCubic(t);
                arc.progress.value = e;
                const pos = arc.curve.getPointAt(e);
                const tan = arc.curve.getTangentAt(Math.min(e, 0.999));
                this.plane.position.copy(pos);
                up.copy(pos).normalize();
                ahead.copy(pos).add(tan);
                this.plane.up.copy(up);
                this.plane.lookAt(ahead);

                // Cámara persecución: se desliza hacia la posición del avión
                const desired = pos.clone().normalize().multiplyScalar(2.95);
                this.camera.position.lerp(desired, 0.06);
                this.camera.lookAt(0, 0, 0);

                if (t < 1) requestAnimationFrame(step);
                else { tour._skip = null; resolve(); }
            };
            requestAnimationFrame(step);
        });
    }

    /** Dibuja el itinerario completo de golpe (modo estático, sin avión). */
    drawItineraryStatic(stops) {
        this.clearItinerary();
        for (let i = 1; i < stops.length; i++) {
            const arc = this._buildArc(stops[i - 1], stops[i]);
            arc.progress.value = 1;
        }
    }

    // ---------------------------------------------------------------
    // Loop / ciclo de vida
    // ---------------------------------------------------------------
    _tick() {
        const t = (performance.now() - this._t0) / 1000;
        // Reanudar rotación tras 9s sin interacción (si no hay selección/tour)
        if (!this.controls.autoRotate && !this._selectedId && !this._tour
            && !this.reducedMotion
            && performance.now() - this._lastInteraction > 9000) {
            this.controls.autoRotate = true;
        }
        // Pulso del anillo de selección
        if (this.selectionRing.visible) {
            const s = 1 + Math.sin(t * 3.2) * 0.22;
            this.selectionRing.scale.setScalar(s);
            this.selectionRing.material.opacity = 0.55 + Math.sin(t * 3.2) * 0.3;
        }
        this._highlightRings.forEach((r, i) => {
            const s = 1 + Math.sin(t * 2.4 + i * 0.7) * 0.12;
            r.scale.setScalar(s);
        });
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    markerById(id) {
        const i = this._markerIndex.get(id);
        return i == null ? null : this.markers[i];
    }

    dispose() {
        this._disposed = true;
        this.renderer.setAnimationLoop(null);
        window.removeEventListener('resize', this._onResize);
        this.clearItinerary();
        this.renderer.dispose();
    }
}
