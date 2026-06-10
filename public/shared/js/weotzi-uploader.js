/**
 * WeOtziUploader
 *
 * Drop-in file uploader to Supabase Storage with progress + preview + URL
 * exposure. Designed to replace "paste a URL" inputs across the studio
 * surfaces (register wizard, dashboard, documents tab).
 *
 * Two modes:
 *
 *   1. Single-file:  attach(input, { bucket, pathPrefix, onUploaded(url, meta) })
 *      - Replaces a text URL input with a file picker.
 *      - On upload completion, the underlying input.value is set to the public
 *        URL so existing form-collection code keeps working unchanged.
 *
 *   2. Multi-file gallery: attachGallery(container, { bucket, pathPrefix, onChange(urls) })
 *      - Renders a thumbnail grid + an "Agregar" tile.
 *      - User picks multiple files; each uploads, appears as a tile, and the
 *        callback receives the cumulative list.
 *
 * Both rely on a global supabase client. We default to window._supabase if it
 * exists; otherwise the caller passes one.
 */
(function (window) {
    'use strict';

    function getClient(opts) {
        return (opts && opts.supabase) || window._supabase || (window.supabase && window.supabase.createClient
            ? null   // not initialized; caller must pass one
            : null);
    }

    function sanitizeFilename(name) {
        return String(name)
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 80);
    }

    function uniquePath(prefix, file) {
        const ts = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        const safeName = sanitizeFilename(file.name) || 'file';
        return `${prefix.replace(/^\/+|\/+$/g, '')}/${ts}-${rand}-${safeName}`;
    }

    async function uploadFile({ supabase, bucket, file, pathPrefix }) {
        if (!supabase) throw new Error('Supabase client no disponible.');
        if (!file)      throw new Error('Sin archivo.');

        const path = uniquePath(pathPrefix, file);
        const { data, error } = await supabase.storage
            .from(bucket)
            .upload(path, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type || undefined
            });
        if (error) throw error;

        // Public URL (works for public buckets; private buckets require signed URLs).
        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
        return {
            path:      data.path,
            publicUrl: urlData?.publicUrl || null,
            mimeType:  file.type || null,
            size:      file.size || 0,
            name:      file.name
        };
    }

    /**
     * Replace a text input with a file-picker UX. The underlying input's
     * .value is updated to the public URL on success so existing serializers
     * pick it up without changes.
     *
     * options:
     *   supabase      - Supabase client (optional, defaults to window._supabase)
     *   bucket        - bucket id (e.g. 'studio-photos')
     *   pathPrefix    - first path segment, typically the studio_id
     *   accept        - HTML accept= attribute (default 'image/*')
     *   onUploaded    - callback(url, meta) after successful upload
     *   placeholder   - placeholder for the URL display
     */
    function attach(input, options) {
        if (!input || input.tagName !== 'INPUT') {
            console.warn('[WeOtziUploader] attach() requires an <input>');
            return null;
        }
        const opts = options || {};
        const supabase = getClient(opts);

        // Wrap the input in a small UI: file button + URL display + status.
        const wrapper = document.createElement('div');
        wrapper.className = 'wo-uploader wo-uploader-single';
        const previewClass = opts.preview === false ? 'wo-uploader-no-preview' : 'wo-uploader-with-preview';
        wrapper.classList.add(previewClass);

        wrapper.innerHTML = `
            <div class="wo-uploader-row">
                <button type="button" class="wo-uploader-btn">
                    <i class="fa-solid fa-cloud-arrow-up"></i> Subir archivo
                </button>
                <span class="wo-uploader-or">o</span>
                <input type="text" class="wo-uploader-url" placeholder="${opts.placeholder || 'pegá una URL'}" autocomplete="off">
            </div>
            ${opts.preview === false ? '' : '<div class="wo-uploader-preview" hidden></div>'}
            <div class="wo-uploader-status" hidden></div>
            <input type="file" class="wo-uploader-file-input" accept="${opts.accept || 'image/*'}" hidden>
        `;
        input.style.display = 'none';
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);

        const fileInput  = wrapper.querySelector('.wo-uploader-file-input');
        const urlInput   = wrapper.querySelector('.wo-uploader-url');
        const previewEl  = wrapper.querySelector('.wo-uploader-preview');
        const statusEl   = wrapper.querySelector('.wo-uploader-status');
        const btn        = wrapper.querySelector('.wo-uploader-btn');

        // Pre-fill URL display + preview if input.value already has something.
        if (input.value) {
            urlInput.value = input.value;
            renderPreview(input.value);
        }

        function showStatus(kind, msg) {
            statusEl.className = 'wo-uploader-status wo-uploader-status-' + kind;
            statusEl.textContent = msg;
            statusEl.hidden = false;
            if (kind === 'success') setTimeout(() => { statusEl.hidden = true; }, 3500);
        }
        function renderPreview(url) {
            if (!previewEl || !url) return;
            previewEl.hidden = false;
            if (/\.(pdf|docx?)(\?|$)/i.test(url)) {
                previewEl.innerHTML = `<a href="${url}" target="_blank" rel="noopener">
                    <i class="fa-solid fa-file-lines"></i> Ver archivo
                </a>`;
            } else {
                previewEl.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
            }
        }

        btn.addEventListener('click', () => fileInput.click());

        urlInput.addEventListener('change', () => {
            const v = urlInput.value.trim();
            input.value = v;
            renderPreview(v);
            if (typeof opts.onUploaded === 'function') opts.onUploaded(v, { source: 'url' });
        });

        fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Subiendo…';
            showStatus('info', `Subiendo ${file.name}…`);

            try {
                const result = await uploadFile({
                    supabase, bucket: opts.bucket, pathPrefix: opts.pathPrefix, file
                });
                input.value = result.publicUrl || '';
                urlInput.value = result.publicUrl || '';
                renderPreview(result.publicUrl);
                showStatus('success', '¡Listo! Archivo subido.');
                if (typeof opts.onUploaded === 'function') opts.onUploaded(result.publicUrl, result);
            } catch (err) {
                console.error('[WeOtziUploader] upload error', err);
                showStatus('error', 'Error al subir: ' + (err.message || err));
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Subir archivo';
                fileInput.value = ''; // allow re-uploading same file later
            }
        });

        return {
            getUrl()   { return input.value; },
            setUrl(v)  { input.value = v || ''; urlInput.value = v || ''; renderPreview(v); },
            destroy()  { wrapper.replaceWith(input); }
        };
    }

    /**
     * Multi-file gallery. Renders into `container`, paints each upload as a
     * thumbnail tile with a remove button, and emits the full URL list.
     *
     * options:
     *   bucket, pathPrefix - same as attach()
     *   initialUrls        - string[] to pre-render
     *   onChange(urls)     - called when the list changes (add/remove)
     */
    function attachGallery(container, options) {
        if (!container) {
            console.warn('[WeOtziUploader] attachGallery() requires a container');
            return null;
        }
        const opts = options || {};
        const supabase = getClient(opts);
        const urls = Array.isArray(opts.initialUrls) ? opts.initialUrls.slice() : [];

        container.classList.add('wo-uploader-gallery');
        container.innerHTML = '';

        const grid = document.createElement('div');
        grid.className = 'wo-uploader-gallery-grid';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.hidden = true;
        fileInput.accept = opts.accept || 'image/*';
        const status = document.createElement('div');
        status.className = 'wo-uploader-status';
        status.hidden = true;

        container.append(grid, status, fileInput);

        function showStatus(kind, msg) {
            status.className = 'wo-uploader-status wo-uploader-status-' + kind;
            status.textContent = msg;
            status.hidden = false;
            if (kind === 'success') setTimeout(() => { status.hidden = true; }, 3000);
        }

        function emit() {
            if (typeof opts.onChange === 'function') opts.onChange(urls.slice());
        }

        function renderTile(url) {
            const tile = document.createElement('div');
            tile.className = 'wo-uploader-tile';
            tile.style.backgroundImage = `url('${url.replace(/'/g, "\\'")}')`;
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'wo-uploader-tile-remove';
            rm.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            rm.addEventListener('click', () => {
                const idx = urls.indexOf(url);
                if (idx >= 0) urls.splice(idx, 1);
                tile.remove();
                emit();
            });
            tile.appendChild(rm);
            return tile;
        }

        function renderAddTile() {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'wo-uploader-add-tile';
            tile.innerHTML = '<i class="fa-solid fa-plus"></i><span>Agregar</span>';
            tile.addEventListener('click', () => fileInput.click());
            return tile;
        }

        function paint() {
            grid.innerHTML = '';
            urls.forEach(u => grid.appendChild(renderTile(u)));
            grid.appendChild(renderAddTile());
        }

        fileInput.addEventListener('change', async () => {
            const files = Array.from(fileInput.files || []);
            if (!files.length) return;
            showStatus('info', `Subiendo ${files.length} archivo${files.length > 1 ? 's' : ''}…`);
            for (const file of files) {
                try {
                    const result = await uploadFile({
                        supabase, bucket: opts.bucket, pathPrefix: opts.pathPrefix, file
                    });
                    if (result.publicUrl) urls.push(result.publicUrl);
                } catch (err) {
                    console.error('[WeOtziUploader] gallery upload error', err);
                    showStatus('error', `Error en ${file.name}: ${err.message || err}`);
                }
            }
            paint();
            emit();
            showStatus('success', '¡Listo!');
            fileInput.value = '';
        });

        paint();

        return {
            getUrls() { return urls.slice(); },
            setUrls(next) {
                urls.length = 0;
                if (Array.isArray(next)) next.forEach(u => urls.push(u));
                paint();
                emit();
            }
        };
    }

    window.WeOtziUploader = {
        attach,
        attachGallery,
        uploadFile
    };
})(window);
