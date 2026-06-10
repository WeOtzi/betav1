// Instagram Import — reusable UI component.
//
// Mounts a "Import from Instagram" button into a container; clicking it
// opens a modal with 3 screens (input → preview → result).
//
// Usage:
//   IGImport.mount(container, {
//     target:    'artist' | 'studio',
//     targetId:  user.id,                 // required for dashboard mode
//     mode:      'signup' | 'dashboard',
//     onComplete: (result) => { ... }     // result = { prefill, imported, ... }
//   });
//
// In `signup` mode: commit returns prefill data; the wizard caller is
// responsible for stuffing those values into its own form fields and
// performing the final upsert (so abandoned signups don't write to DB
// — but Storage uploads still happen and become orphan if the user bails;
// this is an acceptable trade-off given selection happens after preview).
//
// In `dashboard` mode: commit writes directly to DB (the row already exists).

(function () {
    const TRIGGER_LABEL = 'Importar desde Instagram';
    const TRIGGER_HTML = '<i class="fa-brands fa-instagram"></i> ' + TRIGGER_LABEL;

    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            for (const k in attrs) {
                if (k === 'class') node.className = attrs[k];
                else if (k === 'html') node.innerHTML = attrs[k];
                else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
                else node.setAttribute(k, attrs[k]);
            }
        }
        if (children) {
            for (const c of children) {
                if (c == null) continue;
                node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
            }
        }
        return node;
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    async function readJsonResponse(res) {
        const text = await res.text();
        try {
            return text ? JSON.parse(text) : {};
        } catch (_) {
            return {
                success: false,
                error: `Respuesta invalida del servidor (${res.status}). Verifica que la API de Instagram este activa en ${apiUrl('/api/instagram/preview')}.`
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

    // -----------------------------------------------------------------------
    // Modal lifecycle
    // -----------------------------------------------------------------------

    class IGImportModal {
        constructor(opts) {
            this.opts = opts;
            this.payloadId = null;
            this.summary = null;
            this.overlay = null;
            this.body = null;
            this.footer = null;
        }

        open() {
            this.overlay = el('div', { class: 'ig-import-overlay', onclick: (e) => {
                if (e.target === this.overlay) this.close();
            }});

            const header = el('div', { class: 'ig-import-header' }, [
                el('h3', { html: '<i class="fa-brands fa-instagram"></i> Importar desde Instagram' }),
                el('button', { class: 'ig-import-close', onclick: () => this.close(), 'aria-label': 'Cerrar' }, ['×'])
            ]);

            this.body = el('div', { class: 'ig-import-body' });
            this.footer = el('div', { class: 'ig-import-footer' });
            const modal = el('div', { class: 'ig-import-modal' }, [header, this.body, this.footer]);
            this.overlay.appendChild(modal);
            document.body.appendChild(this.overlay);
            document.body.style.overflow = 'hidden';

            this.renderInputScreen();
        }

        close() {
            if (!this.overlay) return;
            this.overlay.remove();
            this.overlay = null;
            document.body.style.overflow = '';
        }

        // ---- Screen 1: Input -------------------------------------------------

        renderInputScreen() {
            this.body.innerHTML = '';
            this.footer.innerHTML = '';

            const handleInput = el('input', {
                type: 'text',
                id: 'ig-handle-input',
                placeholder: 'usuario_instagram',
                maxlength: '30',
                autocomplete: 'off'
            });

            const limitSelect = el('select', { id: 'ig-limit-select' }, [
                el('option', { value: '12' }, ['12 medios (rápido)']),
                el('option', { value: '24' }, ['24 medios']),
                el('option', { value: '50' }, ['50 medios (más completo)'])
            ]);

            this.body.appendChild(el('div', { class: 'ig-import-disclaimer' }, [
                'Solo importamos contenido público. Confirmas que la cuenta es tuya y autorizas la importación.'
            ]));
            this.body.appendChild(el('label', { for: 'ig-handle-input' }, ['Handle de Instagram (sin @)']));
            this.body.appendChild(handleInput);
            this.body.appendChild(el('label', { for: 'ig-limit-select' }, ['Cuántos medios traer']));
            this.body.appendChild(limitSelect);

            const cancelBtn = el('button', {
                class: 'ig-btn ig-btn-secondary',
                onclick: () => this.close()
            }, ['Cancelar']);
            const fetchBtn = el('button', {
                class: 'ig-btn ig-btn-primary',
                onclick: () => this.startPreview(handleInput.value, parseInt(limitSelect.value, 10))
            }, ['Buscar perfil']);

            this.footer.appendChild(cancelBtn);
            this.footer.appendChild(fetchBtn);

            // Pre-fill from outer form if a handle exists.
            if (this.opts.prefillHandle) handleInput.value = String(this.opts.prefillHandle).replace(/^@/, '');
            setTimeout(() => handleInput.focus(), 50);
        }

        async startPreview(rawHandle, limit) {
            const handle = String(rawHandle || '').trim().replace(/^@/, '');
            if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
                this.showStatusError('Handle inválido. Solo letras, números, puntos y guiones bajos.');
                return;
            }
            if (![12, 24, 50].includes(limit)) limit = 12;

            this.renderLoadingScreen('Consultando Instagram… esto puede tomar 5-15 segundos.');

            try {
                const headers = await getAuthHeaders();
                const res = await fetch(apiUrl('/api/instagram/preview'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify({
                        handle,
                        limit,
                        mode: this.opts.mode === 'signup' ? 'signup' : 'dashboard'
                    })
                });
                const data = await readJsonResponse(res);
                if (!res.ok || !data.success) {
                    return this.showStatusError(this.humanizeError(data, res.status));
                }
                this.payloadId = data.payload_id;
                this.summary = data.summary;
                this.handle = handle;
                this.renderPreviewScreen();
            } catch (err) {
                this.showStatusError('No se pudo conectar al servidor: ' + err.message);
            }
        }

        // ---- Screen 2: Preview ----------------------------------------------

        renderPreviewScreen() {
            this.body.innerHTML = '';
            this.footer.innerHTML = '';

            const s = this.summary;

            const profileCard = el('div', { class: 'ig-preview-profile' });
            if (s.profile_pic) {
                // IG CDN blocks cross-origin loads (CORP same-origin). Route
                // through our proxy for reliability.
                const proxiedSrc = apiUrl('/api/instagram/proxy-thumb') + '?url=' + encodeURIComponent(s.profile_pic);
                profileCard.appendChild(el('img', { src: proxiedSrc, alt: '' }));
            }
            profileCard.appendChild(el('div', null, [
                el('div', { class: 'ig-preview-name' }, [s.full_name || s.username]),
                el('div', { class: 'ig-preview-handle' }, ['@' + s.username])
            ]));
            this.body.appendChild(profileCard);

            this.body.appendChild(el('label', null, ['Selecciona qué importar:']));

            const isSignup = this.opts.mode === 'signup';
            const list = el('div', { class: 'ig-checkbox-list' });
            this.checkboxes = {
                bio:      this._cbItem(list, 'bio',      'Biografía',      s.bio_present ? 'Texto disponible' : 'Sin biografía',      s.bio_present),
                bio_link: this._cbItem(list, 'bio_link', 'Enlace en bio',  s.bio_link_present ? 'Enlace disponible' : 'Sin enlace',  s.bio_link_present),
                location: this._cbItem(list, 'location', 'Ubicación',      s.location_guess ? `Detectada: ${s.location_guess} (${s.location_source})` : 'No se detectó', Boolean(s.location_guess)),
                photos:   this._cbItem(list, 'photos',   'Fotos',          s.photos_count > 0 ? `${s.photos_count} foto(s)` : 'Sin fotos',     s.photos_count > 0),
                reels:    this._cbItem(list, 'reels',    'Reels',          s.reels_count > 0 ? `${s.reels_count} reel(s)` : 'Sin reels',      s.reels_count > 0)
            };
            this.body.appendChild(list);

            if (isSignup && (s.photos_count + s.reels_count) > 0) {
                this.body.appendChild(el('div', { class: 'ig-import-disclaimer' }, [
                    'Las fotos y reels los podrás revisar y editar en el paso del portfolio. Se descargan a tu galería al final del registro.'
                ]));
            }

            const backBtn = el('button', {
                class: 'ig-btn ig-btn-secondary',
                onclick: () => this.renderInputScreen()
            }, ['Volver']);
            const importBtn = el('button', {
                class: 'ig-btn ig-btn-primary',
                onclick: () => this.startCommit()
            }, ['Importar seleccionado']);

            this.footer.appendChild(backBtn);
            this.footer.appendChild(importBtn);
        }

        _cbItem(list, key, title, detail, defaultChecked) {
            const cb = el('input', { type: 'checkbox' });
            cb.checked = !!defaultChecked;
            cb.disabled = !defaultChecked && !['photos', 'reels', 'location'].includes(key) ? true : !defaultChecked;
            // Allow toggling even when disabled-by-default if user wants — but
            // ingestion will treat unchecked = skip regardless.
            cb.disabled = false;
            const label = el('label', null, [
                cb,
                el('div', null, [
                    el('span', { class: 'ig-cb-title' }, [title]),
                    el('span', { class: 'ig-cb-detail' }, [detail])
                ])
            ]);
            list.appendChild(label);
            return cb;
        }

        // ---- Screen 3: Loading / Result --------------------------------------

        async startCommit() {
            const selection = {
                bio:      this.checkboxes.bio ? this.checkboxes.bio.checked : false,
                bio_link: this.checkboxes.bio_link ? this.checkboxes.bio_link.checked : false,
                location: this.checkboxes.location ? this.checkboxes.location.checked : false,
                photos:   this.checkboxes.photos ? this.checkboxes.photos.checked : false,
                reels:    this.checkboxes.reels ? this.checkboxes.reels.checked : false
            };
            const totalMedia = (selection.photos ? this.summary.photos_count : 0) + (selection.reels ? this.summary.reels_count : 0);

            this.renderLoadingScreen(totalMedia > 0
                ? `Descargando ${totalMedia} medios… esto puede tomar 10-30 segundos.`
                : 'Aplicando cambios…');

            try {
                const headers = await getAuthHeaders();
                const body = {
                    payload_id: this.payloadId,
                    selection,
                    target: this.opts.target,
                    mode: this.opts.mode === 'signup' ? 'signup' : 'dashboard'
                };
                if (this.opts.targetId) body.target_user_id = this.opts.targetId;
                const res = await fetch(apiUrl('/api/instagram/commit'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify(body)
                });
                const data = await readJsonResponse(res);
                if (!res.ok || !data.success) {
                    return this.showStatusError(this.humanizeError(data, res.status));
                }
                this.renderResultScreen(data);
                if (typeof this.opts.onComplete === 'function') {
                    try {
                        this.opts.onComplete({
                            ...data,
                            handle: this.handle,
                            summary: this.summary
                        });
                    } catch (e) { console.warn('[ig-import] onComplete threw:', e); }
                }
            } catch (err) {
                this.showStatusError('No se pudo importar: ' + err.message);
            }
        }

        renderLoadingScreen(message) {
            this.body.innerHTML = '';
            this.footer.innerHTML = '';
            const status = el('div', { class: 'ig-status' }, [
                el('div', { class: 'ig-spinner' }),
                el('div', null, ['Procesando…']),
                el('div', { class: 'ig-progress-text' }, [message || ''])
            ]);
            this.body.appendChild(status);
        }

        renderResultScreen(data) {
            this.body.innerHTML = '';
            this.footer.innerHTML = '';

            const im = data.imported || {};
            const errs = Array.isArray(data.errors) ? data.errors : [];
            const attempted = Number(data.attempted_media || 0);
            const lines = [];
            if (im.photos) lines.push(`${im.photos} foto(s) importadas`);
            if (im.reels) lines.push(`${im.reels} reel(s) importados`);
            if (im.bio) lines.push('Biografía actualizada');
            if (im.bio_link) lines.push('Enlace de bio actualizado');
            if (im.location_guess) lines.push(`Ubicación sugerida: ${im.location_guess}`);
            if (data.skipped_duplicates) lines.push(`${data.skipped_duplicates} medios omitidos (ya importados)`);

            // A "success" with attempted > 0 but imported = 0 means every media
            // failed to download from the IG CDN. Surface it as an error so
            // the user doesn't think the import worked.
            const importedMedia = (im.photos || 0) + (im.reels || 0);
            const allFailed = attempted > 0 && importedMedia === 0 && errs.length > 0;

            if (allFailed) {
                const reason = errs[0] && errs[0].code === 'MEDIA_DOWNLOAD_FAILED'
                    ? 'Instagram bloqueó la descarga de los archivos. Suele resolverse intentando de nuevo en unos minutos.'
                    : `Falló la descarga de los ${attempted} medios. Detalle: ${errs[0]?.message || 'error desconocido'}.`;
                const errorBox = el('div', { class: 'ig-error-box' }, [
                    el('strong', null, ['No se pudieron importar las fotos/reels.']),
                    el('div', { html: '<br>' + escapeHtml(reason) })
                ]);
                if (lines.length) {
                    errorBox.appendChild(el('div', {
                        html: '<br>Pero sí se aplicaron:<br>' + lines.map(escapeHtml).join('<br>')
                    }));
                }
                this.body.appendChild(errorBox);
            } else {
                if (lines.length === 0) {
                    lines.push('No se importó nada (no hubo selección o todo era duplicado).');
                } else if (errs.length > 0) {
                    lines.push(`${errs.length} medio(s) no se pudieron descargar.`);
                }
                const success = el('div', { class: 'ig-success-box' }, [
                    el('strong', null, ['Listo.']),
                    el('div', { html: '<br>' + lines.map(escapeHtml).join('<br>') })
                ]);
                this.body.appendChild(success);
            }

            const closeBtn = el('button', {
                class: 'ig-btn ig-btn-primary',
                onclick: () => this.close()
            }, ['Cerrar']);
            this.footer.appendChild(closeBtn);
        }

        // ---- Errors ----------------------------------------------------------

        showStatusError(message) {
            this.body.innerHTML = '';
            this.footer.innerHTML = '';
            this.body.appendChild(el('div', { class: 'ig-error-box' }, [message]));

            const backBtn = el('button', {
                class: 'ig-btn ig-btn-secondary',
                onclick: () => this.renderInputScreen()
            }, ['Volver']);
            const closeBtn = el('button', {
                class: 'ig-btn ig-btn-primary',
                onclick: () => this.close()
            }, ['Cerrar']);
            this.footer.appendChild(backBtn);
            this.footer.appendChild(closeBtn);
        }

        humanizeError(data, httpStatus) {
            const code = data && data.code;
            const map = {
                APIFY_NOT_CONFIGURED: 'La integración con Instagram no está configurada. Avisa al administrador.',
                APIFY_TOKEN_REJECTED: 'El token de Apify es inválido. Avisa al administrador.',
                APIFY_RATE_LIMITED:   'Demasiadas importaciones recientes. Intenta en unos minutos.',
                PROFILE_PRIVATE:      'La cuenta es privada. Cámbiala a pública por unos minutos para importar.',
                PROFILE_NOT_FOUND:    'No encontramos ese usuario en Instagram. ¿Está bien escrito?',
                PAYLOAD_EXPIRED:      'La vista previa expiró (15 min). Vuelve a buscar el perfil.',
                INVALID_HANDLE:       'Handle inválido.',
                INVALID_LIMIT:        'Cantidad inválida.',
                INVALID_TARGET:       'Tipo de cuenta inválido.',
                INVALID_TARGET_USER:  'Usuario destino inválido.'
            };
            if (code && map[code]) return map[code];
            if (httpStatus === 401) return 'Necesitas iniciar sesión para importar.';
            if (httpStatus === 403) return 'No tienes permiso para esta acción.';
            return (data && data.error) || 'Error desconocido.';
        }
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    function mount(container, opts) {
        if (!container) return null;
        const o = Object.assign({
            target: 'artist',
            mode: 'signup'
        }, opts || {});

        const trigger = el('button', {
            type: 'button',
            class: 'ig-import-trigger',
            html: TRIGGER_HTML,
            onclick: () => {
                const modal = new IGImportModal(o);
                modal.open();
            }
        });
        container.appendChild(trigger);
        return { trigger };
    }

    // Open the modal directly without a trigger button. Used by entry points
    // that already have their own CTA (e.g., the "Instagram" social-login
    // button on /registerclosedbeta/).
    function open(opts) {
        const o = Object.assign({ target: 'artist', mode: 'signup' }, opts || {});
        const modal = new IGImportModal(o);
        modal.open();
        return modal;
    }

    window.IGImport = { mount, open };
})();
