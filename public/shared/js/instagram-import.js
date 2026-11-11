// Instagram Import — componente reutilizable (Figma final, oct 2026).
//
// Frames: 2003:1191 "01 · Perfil", 2003:1902 "02 · Selección" y
// 2003:2583 "03 · Importación". Monta un botón que abre un diálogo de 3 pasos:
//   01 usuario + cantidad a revisar + confirmación de titularidad
//   02 selección publicación por publicación (bloquea las que no entran)
//   03 resultado ("Tus trabajos ya están en la galería")
//
// Uso:
//   IGImport.mount(container, {
//     target:    'artist' | 'studio',
//     targetId:  user.id,                 // obligatorio en modo dashboard
//     mode:      'signup' | 'dashboard',
//     prefillHandle, triggerLabel,
//     getGalleryState: () => ({ count, max, videos, maxVideos, maxVideoSeconds }),
//     onViewGallery: () => {},            // botón "VER EN LA GALERÍA →"
//     onPreviewImport: async (items) => n // solo preview local (API simulada)
//     onComplete: (result) => { ... }     // result = { prefill, imported, ... }
//   });
//   IGImport.open(opts)  // abre el diálogo sin botón (registerclosedbeta)
//
// Modo `signup`: el commit devuelve prefill (bio, enlace, ubicación y media
// elegida); el wizard lo vuelca en su formulario. Modo `dashboard`: el
// servidor descarga solo los permalinks elegidos (allowed_permalinks) y
// actualiza la galería.
//
// Selección por publicación: usa `summary.media` ([{ permalink, kind,
// thumbnail_url, video_duration }]) si el servidor lo devuelve; si no, cae a
// una selección por tipo (fotos / videos) con los contadores del resumen.
//
// QA (dashboard): ?ig=1 | ?ig=2 | ?ig=3 abre el diálogo en ese paso (los
// pasos 2 y 3 usan WoDemoIGImportSample, disponible en el preview local).

(function () {
    const DEFAULT_TRIGGER_LABEL = 'Importar desde Instagram';
    const SVG = {
        instagram: '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>',
        x: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
        'chevron-down': '<polyline points="6 9 12 15 18 9"></polyline>',
        info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
        'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>',
        'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>',
        check: '<polyline points="20 6 9 17 4 12"></polyline>',
        'alert-triangle': '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>'
    };
    const PLAY = '<svg class="igi-play" viewBox="0 0 10 10" aria-hidden="true"><polygon points="2,1 9,5 2,9"></polygon></svg>';

    function icon(name, cls) {
        return '<svg class="igi-ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (SVG[name] || '') + '</svg>';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function getAppBasePath() {
        if (typeof window === 'undefined') return '';
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const path = window.location?.pathname || '';
        return path === '/beta' || path.startsWith('/beta/') ? '/beta' : '';
    }

    function apiUrl(path) {
        const normalized = String(path || '').startsWith('/') ? path : '/' + path;
        return getAppBasePath() + normalized;
    }

    function mediaUrl(url) {
        const u = String(url || '');
        if (!u) return '';
        if (/^https?:\/\//i.test(u)) return apiUrl('/api/instagram/proxy-thumb') + '?url=' + encodeURIComponent(u);
        if (u.startsWith('/') && !u.startsWith('//')) {
            const base = getAppBasePath();
            return base && !u.startsWith(base + '/') ? base + u : u;
        }
        return u;
    }

    async function readJsonResponse(res) {
        const text = await res.text();
        try {
            return text ? JSON.parse(text) : {};
        } catch (_) {
            return {
                success: false,
                error: `Respuesta inválida del servidor (${res.status}). Verificá que la API de Instagram esté activa en ${apiUrl('/api/instagram/preview')}.`
            };
        }
    }

    async function getAuthHeaders() {
        const client = window.ConfigManager?.getSupabaseClient?.() || window.supabaseClient || null;
        if (!client || !client.auth) return {};
        try {
            const { data } = await client.auth.getSession();
            const token = data && data.session && data.session.access_token;
            return token ? { 'Authorization': `Bearer ${token}` } : {};
        } catch (_) {
            return {};
        }
    }

    function plural(n, one, many) { return n === 1 ? one : many; }
    function duration(seconds) {
        const s = Math.max(0, Math.round(Number(seconds) || 0));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }
    function previewSample() {
        return typeof window !== 'undefined' && window.WoDemoIGImportSample && window.WoDemoIGImportSample.summary
            ? JSON.parse(JSON.stringify(window.WoDemoIGImportSample.summary)) : null;
    }
    function isPreviewBlocked(res, data) {
        return Boolean(res && res.status === 501 && data && data.preview);
    }

    // -----------------------------------------------------------------------
    // Diálogo
    // -----------------------------------------------------------------------
    class IGImportModal {
        constructor(opts) {
            this.opts = opts;
            this.payloadId = null;
            this.summary = null;
            this.handle = String(opts.prefillHandle || '').replace(/^@/, '').trim();
            this.limit = 12;
            this.confirmed = false;
            this.items = [];
            this.selected = [];
            this.simulated = false;
            this.overlay = null;
            this.step = 1;
            this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
        }

        gallery() {
            const fallback = { count: 0, max: 12, videos: 0, maxVideos: 2, maxVideoSeconds: 30 };
            try {
                const g = typeof this.opts.getGalleryState === 'function' ? this.opts.getGalleryState() : null;
                return Object.assign(fallback, g || {});
            } catch (_) { return fallback; }
        }
        freeSlots() { const g = this.gallery(); return Math.max(0, g.max - g.count); }

        open(step) {
            this.lastFocus = document.activeElement;
            this.overlay = document.createElement('div');
            this.overlay.className = 'igi-overlay';
            this.overlay.addEventListener('mousedown', (e) => { if (e.target === this.overlay) this.close(); });
            this.overlay.innerHTML =
                '<div class="igi-dialog" role="dialog" aria-modal="true" aria-labelledby="igi-title" tabindex="-1">' +
                    '<div class="igi-top">' +
                        '<div class="igi-top-row"><p class="igi-kicker">' + icon('instagram') + '<span>GALERÍA · IMPORTAR</span></p>' +
                        '<button type="button" class="igi-close" aria-label="Cerrar importación">' + icon('x') + '</button></div>' +
                        '<ol class="igi-steps" aria-label="Pasos"><li data-step="1">01 · PERFIL</li><li data-step="2">02 · SELECCIÓN</li><li data-step="3">03 · IMPORTACIÓN</li></ol>' +
                    '</div>' +
                    '<div class="igi-body"></div>' +
                    '<div class="igi-foot"></div>' +
                '</div>';
            this.body = this.overlay.querySelector('.igi-body');
            this.foot = this.overlay.querySelector('.igi-foot');
            this.overlay.querySelector('.igi-close').addEventListener('click', () => this.close());
            document.body.appendChild(this.overlay);
            document.body.classList.add('igi-open');
            document.addEventListener('keydown', this._onKey);
            if (step === 2 || step === 3) this.openSample(step);
            else this.renderProfile();
        }

        close() {
            clearInterval(this._galleryTimer);
            if (!this.overlay) return;
            document.removeEventListener('keydown', this._onKey);
            this.overlay.remove();
            this.overlay = null;
            document.body.classList.remove('igi-open');
            if (this.lastFocus && document.contains(this.lastFocus)) { try { this.lastFocus.focus(); } catch (_) { /* noop */ } }
        }

        setStep(n) {
            this.step = n;
            this.overlay.querySelectorAll('.igi-steps li').forEach((li) => {
                const s = Number(li.getAttribute('data-step'));
                li.classList.toggle('is-current', s === n);
                li.classList.toggle('is-done', s < n);
                if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
            });
        }

        focusFirst(selector) {
            const el = this.overlay && this.overlay.querySelector(selector);
            if (el) setTimeout(() => { try { el.focus(); } catch (_) { /* noop */ } }, 40);
        }

        // ---- 01 · Perfil (2003:1191) -----------------------------------------
        renderProfile(errorMessage) {
            this.setStep(1);
            const g = this.gallery();
            const free = this.freeSlots();
            this.body.innerHTML =
                '<h2 class="igi-title" id="igi-title">Importá tus trabajos de Instagram</h2>' +
                '<p class="igi-sub">Elegí las publicaciones que querés sumar a tu galería.</p>' +
                '<div class="igi-fields">' +
                    '<div class="igi-field"><label class="igi-label" for="igi-handle">USUARIO DE INSTAGRAM</label>' +
                        '<div class="igi-input-wrap"><span class="igi-at" aria-hidden="true">@</span>' +
                        '<input id="igi-handle" class="igi-input" type="text" maxlength="31" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="tu.usuario" value="' + escapeHtml(this.handle) + '"></div>' +
                        '<p class="igi-help">Podés escribirlo con o sin @.</p></div>' +
                    '<div class="igi-field"><label class="igi-label" for="igi-limit">PUBLICACIONES A BUSCAR</label>' +
                        '<div class="igi-select-wrap"><select id="igi-limit" class="igi-select">' +
                            '<option value="12">Últimas 12 publicaciones (máximo)</option>' +
                            '<option value="24">Últimas 24 publicaciones</option>' +
                            '<option value="50">Últimas 50 publicaciones</option>' +
                        '</select>' + icon('chevron-down', 'igi-select-chev') + '</div>' +
                        '<div class="igi-facts">' +
                            '<div><p class="igi-fact-l">VAMOS A REVISAR</p><p class="igi-fact-v" data-review>' + this.limit + ' publicaciones</p></div>' +
                            '<div><p class="igi-fact-l">ESPACIOS LIBRES EN TU GALERÍA</p><p class="igi-fact-v" data-free>' + free + ' de ' + g.max + '</p></div>' +
                        '</div></div>' +
                    '<p class="igi-note">' + icon('info') + '<span>Solo podemos importar contenido de cuentas públicas.</span></p>' +
                    '<label class="igi-confirm"><input type="checkbox" id="igi-confirm"' + (this.confirmed ? ' checked' : '') + '><span class="igi-box" aria-hidden="true">' + icon('check') + '</span>' +
                        '<span>Confirmo que esta cuenta es mía y autorizo la importación de su contenido.</span></label>' +
                    '<p class="igi-error" role="alert"' + (errorMessage ? '' : ' hidden') + '>' + escapeHtml(errorMessage || '') + '</p>' +
                '</div>';
            this.foot.className = 'igi-foot';
            this.foot.innerHTML =
                '<button type="button" class="igi-btn is-text" data-cancel>CANCELAR</button>' +
                '<button type="button" class="igi-btn is-accent" data-search>BUSCAR PERFIL →</button>';
            const handleInput = this.body.querySelector('#igi-handle');
            const limit = this.body.querySelector('#igi-limit');
            const confirm = this.body.querySelector('#igi-confirm');
            limit.value = String(this.limit);
            limit.addEventListener('change', () => {
                this.limit = Number(limit.value) || 12;
                this.body.querySelector('[data-review]').textContent = this.limit + ' publicaciones';
            });
            confirm.addEventListener('change', () => { this.confirmed = confirm.checked; });
            handleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.startPreview(); } });
            this.foot.querySelector('[data-cancel]').addEventListener('click', () => this.close());
            this.foot.querySelector('[data-search]').addEventListener('click', () => this.startPreview());
            this.focusFirst('#igi-handle');
            this.watchGallery();
        }

        // La galería puede terminar de cargar con el diálogo ya abierto: el
        // dato de cupos libres se refresca mientras se está en el paso 01.
        watchGallery() {
            clearInterval(this._galleryTimer);
            let ticks = 0;
            this._galleryTimer = setInterval(() => {
                const slot = this.overlay && this.step === 1 && this.body.querySelector('[data-free]');
                if (!slot || ++ticks > 20) { clearInterval(this._galleryTimer); return; }
                const g = this.gallery();
                const text = this.freeSlots() + ' de ' + g.max;
                if (slot.textContent !== text) slot.textContent = text;
            }, 500);
        }

        showInlineError(message) {
            const box = this.body.querySelector('.igi-error');
            if (!box) return;
            box.textContent = message;
            box.hidden = false;
        }

        async startPreview() {
            const input = this.body.querySelector('#igi-handle');
            const handle = String(input ? input.value : this.handle).trim().replace(/^@+/, '');
            this.handle = handle;
            this.confirmed = Boolean(this.body.querySelector('#igi-confirm')?.checked);
            if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
                this.showInlineError('Revisá el usuario: solo letras, números, puntos y guiones bajos.');
                if (input) input.focus();
                return;
            }
            if (!this.confirmed) {
                this.showInlineError('Confirmá que la cuenta es tuya para seguir.');
                return;
            }
            this.renderLoading('Buscando @' + handle + ' en Instagram. Puede tardar entre 5 y 15 segundos.');
            try {
                const headers = await getAuthHeaders();
                const res = await fetch(apiUrl('/api/instagram/preview'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify({ handle, limit: this.limit, mode: this.opts.mode === 'signup' ? 'signup' : 'dashboard' })
                });
                const data = await readJsonResponse(res);
                if (isPreviewBlocked(res, data) && previewSample()) {
                    this.simulated = true;
                    this.payloadId = 'preview-sample';
                    this.summary = previewSample();
                    this.summary.username = handle;
                    this.renderSelection();
                    return;
                }
                if (!res.ok || !data.success) return this.renderProfile(this.humanizeError(data, res.status));
                this.simulated = false;
                this.payloadId = data.payload_id;
                this.summary = data.summary || {};
                this.renderSelection();
            } catch (err) {
                this.renderProfile('No se pudo conectar con el servidor: ' + err.message);
            }
        }

        openSample(step) {
            const sample = previewSample();
            if (!sample) { this.renderProfile(); return; }
            this.simulated = true;
            this.payloadId = 'preview-sample';
            this.summary = sample;
            this.handle = sample.username;
            this.confirmed = true;
            this.renderSelection();
            // QA ?ig=3 (2003:2583): corre la importación simulada de la
            // selección para que la galería de atrás muestre NUEVO · IG.
            if (step === 3) this.startCommit();
        }

        // ---- 02 · Selección (2003:1902) --------------------------------------
        buildItems() {
            const s = this.summary || {};
            const g = this.gallery();
            const media = Array.isArray(s.media) ? s.media.filter((m) => m && (m.permalink || m.thumbnail_url)) : [];
            if (media.length) {
                return media.map((m, i) => {
                    const isVideo = m.kind === 'reel' || m.kind === 'video';
                    const seconds = Number(m.video_duration || m.duration || 0) || null;
                    return {
                        id: 'm' + i, kind: isVideo ? 'reel' : 'image', permalink: m.permalink || null,
                        thumbnail_url: m.thumbnail_url || m.cdn_url || '', caption: m.caption || '',
                        seconds, tooLong: Boolean(isVideo && seconds && seconds > g.maxVideoSeconds)
                    };
                });
            }
            // Sin detalle por publicación: selección por tipo.
            const out = [];
            if (s.photos_count > 0) out.push({ id: 'all-photos', kind: 'image', group: true, count: s.photos_count, caption: 'Fotos' });
            if (s.reels_count > 0) out.push({ id: 'all-reels', kind: 'reel', group: true, count: s.reels_count, caption: 'Videos' });
            return out;
        }

        unitsOf(item) { return item.group ? item.count : 1; }
        videosOf(item) { return item.kind === 'reel' ? this.unitsOf(item) : 0; }

        blockReason(item) {
            if (this.selected.indexOf(item.id) !== -1) return '';
            const g = this.gallery();
            if (item.tooLong) return 'DURA ' + item.seconds + ' S';
            const used = this.selected.reduce((n, id) => n + this.unitsOf(this.items.find((x) => x.id === id)), 0);
            if (used + this.unitsOf(item) > this.freeSlots()) return 'SIN ESPACIO';
            const vids = this.selected.reduce((n, id) => n + this.videosOf(this.items.find((x) => x.id === id)), 0);
            if (item.kind === 'reel' && g.videos + vids + this.videosOf(item) > g.maxVideos) return 'LÍMITE DE VIDEOS';
            return '';
        }

        // Preselección: lo que entra, en orden, como en el Figma.
        preselect() {
            this.selected = [];
            this.items.forEach((item) => {
                if (!this.blockReason(item)) this.selected.push(item.id);
            });
            if (this.items.some((i) => !i.group) && this.selected.length > 3) this.selected = this.selected.slice(0, 3);
        }

        renderSelection() {
            this.setStep(2);
            this.items = this.buildItems();
            this.preselect();
            this.paintSelection();
        }

        paintSelection() {
            const s = this.summary || {};
            const g = this.gallery();
            const total = (s.media && s.media.length) || ((s.photos_count || 0) + (s.reels_count || 0));
            const initials = String(s.username || this.handle || 'IG').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
            const usedUnits = this.selected.reduce((n, id) => n + this.unitsOf(this.items.find((x) => x.id === id)), 0);
            const usedVideos = this.selected.reduce((n, id) => n + this.videosOf(this.items.find((x) => x.id === id)), 0);
            const free = Math.max(0, this.freeSlots() - usedUnits);
            const pic = s.profile_pic ? '<img src="' + escapeHtml(mediaUrl(s.profile_pic)) + '" alt="">' : escapeHtml(initials);
            this.body.innerHTML =
                '<div class="igi-account">' +
                    '<span class="igi-avatar">' + pic + '</span>' +
                    '<span class="igi-account-id"><strong>@' + escapeHtml(s.username || this.handle) + '</strong>' +
                    '<small>Cuenta pública · ' + total + ' ' + plural(total, 'publicación encontrada', 'publicaciones encontradas') + '</small></span>' +
                    '<button type="button" class="igi-link" data-change>CAMBIAR CUENTA</button>' +
                '</div>' +
                '<h2 class="igi-title igi-title--s" id="igi-title">Elegí qué sumar</h2>' +
                '<p class="igi-sub">Tocá una publicación para seleccionarla. Las que no cumplen los requisitos aparecen bloqueadas.</p>' +
                '<div class="igi-status" role="status">' +
                    '<div class="is-on"><strong>' + usedUnits + '</strong><span>' + plural(usedUnits, 'SELECCIONADA', 'SELECCIONADAS') + '</span></div>' +
                    '<div><strong>' + free + '</strong><span>' + plural(free, 'ESPACIO LIBRE', 'ESPACIOS LIBRES') + '</span></div>' +
                    '<div><strong>' + (g.videos + usedVideos) + '/' + g.maxVideos + '</strong><span>VIDEOS EN GALERÍA</span></div>' +
                '</div>' +
                (this.items.length
                    ? '<div class="igi-grid">' + this.items.map((item) => this.tileHtml(item)).join('') + '</div>'
                    : '<p class="igi-empty">No encontramos publicaciones para importar en esta cuenta.</p>') +
                (this.items.some((i) => i.group) ? '<p class="igi-note">' + icon('info') + '<span>Instagram no nos dio el detalle de cada publicación: se suman las más recientes del tipo elegido.</span></p>' : '');
            this.foot.className = 'igi-foot';
            this.foot.innerHTML =
                '<button type="button" class="igi-btn is-text" data-back>' + icon('arrow-left') + '<span>VOLVER</span></button>' +
                '<button type="button" class="igi-btn is-accent" data-import' + (usedUnits ? '' : ' disabled') + '>IMPORTAR ' + usedUnits + ' ' + plural(usedUnits, 'PUBLICACIÓN', 'PUBLICACIONES') + '</button>';
            this.body.querySelector('[data-change]').addEventListener('click', () => this.renderProfile());
            this.foot.querySelector('[data-back]').addEventListener('click', () => this.renderProfile());
            this.foot.querySelector('[data-import]').addEventListener('click', () => this.startCommit());
            this.body.querySelectorAll('[data-item]').forEach((btn) => {
                btn.addEventListener('click', () => this.toggle(btn.getAttribute('data-item')));
            });
        }

        tileHtml(item) {
            const idx = this.selected.indexOf(item.id);
            const on = idx !== -1;
            const reason = on ? '' : this.blockReason(item);
            const kindLabel = item.kind === 'reel'
                ? PLAY + '<span>' + (item.group ? 'VIDEOS · ' + item.count : (item.seconds ? duration(item.seconds) + ' · MP4' : 'VIDEO')) + '</span>'
                : '<span>' + (item.group ? 'FOTOS · ' + item.count : 'FOTO') + '</span>';
            const thumb = item.thumbnail_url
                ? '<img src="' + escapeHtml(mediaUrl(item.thumbnail_url)) + '" alt="" loading="lazy">'
                : '<span class="igi-tile-ph" aria-hidden="true">' + icon('instagram') + '</span>';
            const label = (item.caption || (item.kind === 'reel' ? 'Video' : 'Foto')) + (on ? ', seleccionada' : reason ? ', no disponible: ' + reason.toLowerCase() : '');
            return '<button type="button" class="igi-tile' + (on ? ' is-on' : '') + (reason ? ' is-blocked' : '') + '" data-item="' + escapeHtml(item.id) + '"' +
                ' aria-pressed="' + on + '"' + (reason ? ' aria-disabled="true"' : '') + ' aria-label="' + escapeHtml(label) + '">' +
                thumb +
                (reason ? '<span class="igi-tile-block">' + escapeHtml(reason) + '</span>' : '') +
                '<span class="igi-tile-kind">' + kindLabel + '</span>' +
                (on ? '<span class="igi-tile-n">' + (idx + 1) + '</span>' : (reason ? '' : '<span class="igi-tile-check" aria-hidden="true"></span>')) +
            '</button>';
        }

        toggle(id) {
            const idx = this.selected.indexOf(id);
            if (idx !== -1) this.selected.splice(idx, 1);
            else {
                const item = this.items.find((x) => x.id === id);
                if (!item || this.blockReason(item)) return;
                this.selected.push(id);
            }
            this.paintSelection();
            const again = this.body.querySelector('[data-item="' + id + '"]');
            if (again) again.focus();
        }

        // ---- Commit ----------------------------------------------------------
        selectedItems() {
            return this.selected.map((id) => this.items.find((x) => x.id === id)).filter(Boolean);
        }

        async startCommit() {
            const chosen = this.selectedItems();
            const units = chosen.reduce((n, it) => n + this.unitsOf(it), 0);
            if (!units) return;
            this.renderLoading('Importando ' + units + ' ' + plural(units, 'publicación', 'publicaciones') + '. Puede tardar entre 10 y 30 segundos.');
            const isSignup = this.opts.mode === 'signup';
            const s = this.summary || {};
            const freeBefore = this.freeSlots();
            const permalinks = chosen.filter((it) => !it.group && it.permalink).map((it) => it.permalink);
            const selection = {
                photos: chosen.some((it) => it.kind === 'image'),
                reels: chosen.some((it) => it.kind === 'reel'),
                // En el registro se siguen trayendo bio, enlace y ubicación (prefill del wizard).
                bio: isSignup && Boolean(s.bio_present),
                bio_link: isSignup && Boolean(s.bio_link_present),
                location: isSignup && Boolean(s.location_guess)
            };

            if (this.simulated) return this.commitSimulated(chosen, units, freeBefore);

            try {
                const headers = await getAuthHeaders();
                const body = {
                    payload_id: this.payloadId, selection, target: this.opts.target,
                    mode: isSignup ? 'signup' : 'dashboard'
                };
                if (permalinks.length) body.allowed_permalinks = permalinks;
                if (this.opts.targetId) body.target_user_id = this.opts.targetId;
                const res = await fetch(apiUrl('/api/instagram/commit'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify(body)
                });
                const data = await readJsonResponse(res);
                if (!res.ok || !data.success) return this.renderFailure(this.humanizeError(data, res.status));
                if (isSignup && permalinks.length && data.prefill && Array.isArray(data.prefill.media)) {
                    const keep = new Set(permalinks);
                    data.prefill.media = data.prefill.media.filter((m) => m && keep.has(m.permalink));
                }
                const im = data.imported || {};
                const imported = isSignup ? units : (im.photos || 0) + (im.reels || 0);
                const errs = Array.isArray(data.errors) ? data.errors : [];
                if (!isSignup && Number(data.attempted_media || 0) > 0 && imported === 0 && errs.length) {
                    return this.renderFailure(errs[0] && errs[0].code === 'MEDIA_DOWNLOAD_FAILED'
                        ? 'Instagram bloqueó la descarga de los archivos. Suele resolverse probando de nuevo en unos minutos.'
                        : 'No pudimos descargar las publicaciones. Detalle: ' + (errs[0]?.message || 'error desconocido') + '.');
                }
                this.notifyComplete(data);
                this.renderDone({ count: imported, handle: s.username || this.handle, errors: errs, skipped: data.skipped_duplicates || 0,
                    freeAfter: Math.max(0, freeBefore - imported) });
            } catch (err) {
                this.renderFailure('No se pudo importar: ' + err.message);
            }
        }

        async commitSimulated(chosen, units, freeBefore) {
            const s = this.summary || {};
            const items = chosen.filter((it) => !it.group).map((it) => ({
                permalink: it.permalink, kind: it.kind, thumbnail_url: mediaUrl(it.thumbnail_url), caption: it.caption,
                video_duration: it.seconds || null
            }));
            try {
                let count = units;
                if (this.opts.mode !== 'signup' && typeof this.opts.onPreviewImport === 'function') {
                    count = await this.opts.onPreviewImport(items);
                }
                const data = {
                    success: true, preview: true,
                    imported: { photos: items.filter((i) => i.kind === 'image').length, reels: items.filter((i) => i.kind === 'reel').length },
                    prefill: { handle: s.username || this.handle, bio: null, bio_link: null, location_guess: s.location_guess || null,
                        media: items.map((i) => ({ permalink: i.permalink, kind: i.kind === 'reel' ? 'video' : 'image', cdn_url: i.thumbnail_url, thumbnail_url: i.thumbnail_url, category: 'instagram' })) }
                };
                if (this.opts.mode === 'signup') this.notifyComplete(data);
                this.renderDone({ count, handle: s.username || this.handle, errors: [], freeAfter: Math.max(0, freeBefore - count) });
            } catch (err) {
                this.renderFailure('No se pudo importar en la vista previa: ' + (err && err.message ? err.message : 'error desconocido'));
            }
        }

        notifyComplete(data) {
            if (typeof this.opts.onComplete !== 'function') return;
            try { this.opts.onComplete({ ...data, handle: this.handle, summary: this.summary }); }
            catch (e) { console.warn('[ig-import] onComplete threw:', e); }
        }

        // ---- 03 · Importación (2003:2583) ------------------------------------
        renderDone(result) {
            this.setStep(3);
            const isSignup = this.opts.mode === 'signup';
            const n = result.count || 0;
            const free = result.freeAfter;
            const errs = result.errors || [];
            const lines = [];
            if (result.skipped) lines.push(result.skipped + ' ' + plural(result.skipped, 'publicación ya estaba', 'publicaciones ya estaban') + ' en tu galería.');
            if (errs.length) lines.push(errs.length + ' ' + plural(errs.length, 'publicación no se pudo', 'publicaciones no se pudieron') + ' descargar. Probá de nuevo en unos minutos.');
            this.body.innerHTML =
                '<div class="igi-done">' +
                    '<span class="igi-done-ic">' + icon('check') + '</span>' +
                    '<h2 class="igi-title" id="igi-title">' + (isSignup ? 'Tus trabajos ya están en tu portafolio' : 'Tus trabajos ya están en la galería') + '</h2>' +
                    '<p class="igi-sub">Sumamos ' + n + ' ' + plural(n, 'publicación', 'publicaciones') + ' desde @' + escapeHtml(result.handle) + '.' +
                    (isSignup ? '' : ' Te ' + plural(free, 'queda', 'quedan') + ' ' + free + ' ' + plural(free, 'espacio libre', 'espacios libres') + '.') + '</p>' +
                    (lines.length ? '<p class="igi-warn">' + icon('alert-triangle') + '<span>' + lines.map(escapeHtml).join(' ') + '</span></p>' : '') +
                '</div>';
            this.foot.className = 'igi-foot is-end';
            this.foot.innerHTML = '<button type="button" class="igi-btn is-accent" data-view>' +
                (isSignup ? 'CONTINUAR' : 'VER EN LA GALERÍA') + icon('arrow-right') + '</button>';
            this.foot.querySelector('[data-view]').addEventListener('click', () => {
                this.close();
                if (!isSignup && typeof this.opts.onViewGallery === 'function') this.opts.onViewGallery();
            });
            this.focusFirst('.igi-dialog');
        }

        renderLoading(message) {
            this.body.innerHTML = '<div class="igi-loading" role="status"><span class="igi-spinner" aria-hidden="true"></span>' +
                '<p class="igi-sub">' + escapeHtml(message) + '</p></div>';
            this.foot.className = 'igi-foot is-end';
            this.foot.innerHTML = '<button type="button" class="igi-btn is-text" data-cancel>CANCELAR</button>';
            this.foot.querySelector('[data-cancel]').addEventListener('click', () => this.close());
        }

        renderFailure(message) {
            this.body.innerHTML = '<div class="igi-fail" role="alert">' + icon('alert-triangle') +
                '<div><p class="igi-fail-t">No pudimos completar la importación</p><p class="igi-sub">' + escapeHtml(message) + '</p></div></div>';
            this.foot.className = 'igi-foot';
            this.foot.innerHTML =
                '<button type="button" class="igi-btn is-text" data-back>' + icon('arrow-left') + '<span>VOLVER</span></button>' +
                '<button type="button" class="igi-btn is-accent" data-close>CERRAR</button>';
            this.foot.querySelector('[data-back]').addEventListener('click', () => (this.summary ? this.paintSelection() : this.renderProfile()));
            this.foot.querySelector('[data-close]').addEventListener('click', () => this.close());
        }

        humanizeError(data, httpStatus) {
            const code = data && data.code;
            const map = {
                APIFY_NOT_CONFIGURED: 'La integración con Instagram no está configurada. Avisá a soporte.',
                APIFY_TOKEN_REJECTED: 'La integración con Instagram no está disponible. Avisá a soporte.',
                APIFY_RATE_LIMITED: 'Hubo muchas importaciones seguidas. Probá de nuevo en unos minutos.',
                PROFILE_PRIVATE: 'La cuenta es privada. Hacela pública unos minutos para importar.',
                PROFILE_NOT_FOUND: 'No encontramos ese usuario en Instagram. ¿Está bien escrito?',
                PAYLOAD_EXPIRED: 'La búsqueda venció (15 min). Volvé a buscar el perfil.',
                INVALID_HANDLE: 'Revisá el usuario de Instagram.',
                INVALID_LIMIT: 'Elegí cuántas publicaciones buscar.',
                INVALID_TARGET: 'Tipo de cuenta inválido.',
                INVALID_TARGET_USER: 'Usuario de destino inválido.'
            };
            if (code && map[code]) return map[code];
            if (data && data.preview) return 'La importación de Instagram no está disponible en esta vista previa.';
            if (httpStatus === 401) return 'Iniciá sesión para importar.';
            if (httpStatus === 403) return 'No tenés permiso para esta acción.';
            if (httpStatus === 429) return 'Hubo muchas importaciones seguidas. Probá de nuevo en unos minutos.';
            return (data && data.error) || 'Error desconocido.';
        }
    }

    // -----------------------------------------------------------------------
    // API pública
    // -----------------------------------------------------------------------
    function mount(container, opts) {
        if (!container) return null;
        const o = Object.assign({ target: 'artist', mode: 'signup' }, opts || {});
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ig-import-trigger';
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.innerHTML = icon('instagram') + '<span>' + escapeHtml(o.triggerLabel || DEFAULT_TRIGGER_LABEL) + '</span>';
        trigger.addEventListener('click', () => new IGImportModal(o).open(1));
        container.appendChild(trigger);

        if (o.mode === 'dashboard' && typeof window !== 'undefined') {
            const step = Number(new URLSearchParams(window.location.search).get('ig'));
            if (step >= 1 && step <= 3) {
                // Espera a que la página tenga los datos de la galería (cupos libres).
                let tries = 0;
                const ready = () => typeof o.getGalleryState !== 'function' || Boolean(o.getGalleryState());
                const openWhenReady = () => {
                    // QA: margen extra para que termine la carga completa del perfil.
                    if (ready() || ++tries > 40) setTimeout(() => new IGImportModal(o).open(step), 1500);
                    else setTimeout(openWhenReady, 150);
                };
                setTimeout(openWhenReady, 0);
            }
        }
        return { trigger };
    }

    // Abre el diálogo sin botón (p. ej. botón "Instagram" de /registerclosedbeta/).
    function open(opts) {
        const o = Object.assign({ target: 'artist', mode: 'signup' }, opts || {});
        const modal = new IGImportModal(o);
        modal.open(1);
        return modal;
    }

    window.IGImport = { mount, open };
})();
