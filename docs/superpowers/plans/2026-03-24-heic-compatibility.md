# HEIC Image Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar compatibilidad transparente con formato HEIC/HEIF en todos los puntos de subida de imágenes, convirtiendo automáticamente a JPEG con compresión en el cliente antes de subir a Supabase.

**Architecture:** Se crea un módulo compartido `heic-converter.js` con tres utilidades: `convertIfHEIC` (conversión HEIC→JPEG via heic2any), `compressImage` (compresión via browser-image-compression en Web Worker), y `UploadQueue` (cola secuencial solo para uploads inmediatos del dashboard). En formularios multi-step (cotizaciones y job board), la conversión y compresión ocurren al momento de seleccionar el archivo, pero el upload a Supabase permanece en su lugar original (al enviar el formulario).

**Tech Stack:** Vanilla JS, heic2any@0.0.4 (CDN), browser-image-compression@2.0.2 (CDN), Supabase Storage

---

## File Map

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `public/shared/js/heic-converter.js` | **CREAR** | `convertIfHEIC`, `compressImage`, `UploadQueue` |
| `public/artist/dashboard/index.html` | **MODIFICAR** | CDN scripts en `<head>`, `heic-converter.js` antes de `dashboard.js`, `accept` en inputs |
| `public/quotation/index.html` | **MODIFICAR** | CDN scripts en `<head>`, `heic-converter.js` antes de `script.js`, `accept` en input |
| `public/job-board/request/index.html` | **MODIFICAR** | CDN scripts en `<head>`, `heic-converter.js` antes de `job-board-request.js` |
| `public/shared/js/dashboard.js` | **MODIFICAR** | Relajar type guards, integrar UploadQueue en avatar + galería |
| `public/shared/js/script.js` | **MODIFICAR** | Convertir + comprimir en `handleFiles` antes de push a `uploadedFiles[]` |
| `public/shared/js/job-board-request.js` | **MODIFICAR** | ACCEPTED_IMAGE_TYPES, accept string en renderColorRefs, conversión en addFiles |

---

## Task 1: Crear `heic-converter.js` — utilidades compartidas

**Files:**
- Create: `public/shared/js/heic-converter.js`

Este archivo debe existir y estar completo antes de modificar cualquier otro JS.

- [ ] **Step 1: Crear el archivo**

Crear `public/shared/js/heic-converter.js` con el siguiente contenido exacto:

```javascript
// heic-converter.js
// Shared utilities for HEIC detection, conversion, and compression.
// Requires: heic2any and imageCompression (browser-image-compression) loaded before this file.

/**
 * Detecta si un archivo es HEIC/HEIF por extensión o por MIME type.
 * En Chrome/Firefox, file.type puede estar vacío para HEIC.
 */
function isHEICFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const type = (file.type || '').toLowerCase();
    return ext === 'heic' || ext === 'heif' || type === 'image/heic' || type === 'image/heif';
}

/**
 * Convierte un archivo HEIC/HEIF a JPEG.
 * Si el archivo no es HEIC o la conversión falla (ej. iOS Safari ya lo convirtió),
 * devuelve el archivo original sin cambios — esto es comportamiento esperado, no un error.
 *
 * @param {File} file
 * @returns {Promise<File>}
 */
async function convertIfHEIC(file) {
    if (!isHEICFile(file)) return file;

    try {
        const blob = await heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: 0.85
        });
        const resultBlob = Array.isArray(blob) ? blob[0] : blob;
        const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
        return new File([resultBlob], newName, { type: 'image/jpeg' });
    } catch (err) {
        // iOS Safari puede entregar el archivo ya como JPEG; heic2any lanza en ese caso.
        // Se devuelve el original silenciosamente.
        console.warn('[heic-converter] convertIfHEIC: returning original (conversion not needed or failed)', err.message);
        return file;
    }
}

/**
 * Comprime una imagen usando browser-image-compression en un Web Worker.
 * No bloquea el hilo principal — seguro para móviles.
 * Normaliza la extensión del nombre a .jpg si el tipo de salida es image/jpeg.
 *
 * @param {File} file
 * @returns {Promise<File>}
 */
async function compressImage(file) {
    try {
        const options = {
            maxSizeMB: 1,
            maxWidthOrHeight: 2000,
            useWebWorker: true,
            fileType: 'image/jpeg',
            initialQuality: 0.85
        };
        const compressed = await imageCompression(file, options);
        const outputType = compressed.type || 'image/jpeg';
        // Normalizar nombre: si el tipo es JPEG pero el nombre tiene extensión .heic/.heif, corregir
        let outputName = file.name;
        if (outputType === 'image/jpeg' && /\.(heic|heif)$/i.test(outputName)) {
            outputName = outputName.replace(/\.(heic|heif)$/i, '.jpg');
        }
        return new File([compressed], outputName, { type: outputType });
    } catch (err) {
        console.warn('[heic-converter] compressImage: returning original file', err.message);
        return file;
    }
}

/**
 * Cola de subida secuencial: convierte → comprime → sube → siguiente.
 * Solo para puntos de upload INMEDIATO (ej. avatar, galería del dashboard).
 * No usar en formularios multi-step donde el upload ocurre al enviar.
 *
 * Expone una Promise `done` que resuelve cuando todos los archivos han sido procesados.
 *
 * @example
 *   const queue = new UploadQueue(
 *     async (file) => { await supabase.storage.from('bucket').upload(path, file); },
 *     (current, total) => { showProgress(`${current}/${total}`); },
 *     (file, err) => { showError(`Error en ${file.name}: ${err.message}`); }
 *   );
 *   await queue.addFiles(fileList);
 */
class UploadQueue {
    constructor(uploadFn, onProgress, onError) {
        this._uploadFn = uploadFn;
        this._onProgress = onProgress || (() => {});
        this._onError = onError || (() => {});
        this._queue = [];
        this._total = 0;
        this._processed = 0;
        this._doneResolve = null;
        this.done = Promise.resolve();
    }

    /**
     * Agrega archivos a la cola y retorna una Promise que resuelve cuando todos terminan.
     * @param {File[]|FileList} files
     * @returns {Promise<void>}
     */
    addFiles(files) {
        const arr = Array.from(files);
        this._queue.push(...arr);
        this._total += arr.length;
        this.done = new Promise(resolve => { this._doneResolve = resolve; });
        this._processNext();
        return this.done;
    }

    async _processNext() {
        if (this._queue.length === 0) {
            this._total = 0;
            this._processed = 0;
            if (this._doneResolve) this._doneResolve();
            return;
        }

        const file = this._queue.shift();
        this._processed++;
        this._onProgress(this._processed, this._total + this._queue.length + 1);

        try {
            const converted = await convertIfHEIC(file);
            const compressed = await compressImage(converted);
            await this._uploadFn(compressed);
        } catch (err) {
            this._onError(file, err);
        }

        await this._processNext();
    }
}
```

- [ ] **Step 2: Verificar que el archivo fue creado**

```bash
ls -la "public/shared/js/heic-converter.js"
```

Resultado esperado: archivo existe, tamaño > 1KB.

- [ ] **Step 3: Commit**

```bash
git add public/shared/js/heic-converter.js
git commit -m "feat: add heic-converter.js shared utility (convertIfHEIC, compressImage, UploadQueue)"
```

---

## Task 2: Configurar HTML del Dashboard de artistas

**Files:**
- Modify: `public/artist/dashboard/index.html`

- [ ] **Step 1: Agregar CDN scripts en `<head>` (línea 16)**

Localizar en `public/artist/dashboard/index.html`:
```html
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="/shared/js/config-manager.js"></script>
```

Cambiar a:
```html
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js"></script>
    <script src="/shared/js/config-manager.js"></script>
```

- [ ] **Step 2: Agregar `heic-converter.js` antes de `dashboard.js` (línea ~834)**

Localizar en el fondo del `<body>`:
```html
    <script src="/shared/js/bio-formatting.js"></script>
    <script src="/shared/js/artist-auth.js"></script>
    <script src="/shared/js/dashboard.js"></script>
    <script src="/shared/js/feedback.js"></script>
    <script src="/shared/js/header-effects.js"></script>
```

Cambiar a (los 5 scripts deben quedar presentes):
```html
    <script src="/shared/js/bio-formatting.js"></script>
    <script src="/shared/js/artist-auth.js"></script>
    <script src="/shared/js/heic-converter.js"></script>
    <script src="/shared/js/dashboard.js"></script>
    <script src="/shared/js/feedback.js"></script>
    <script src="/shared/js/header-effects.js"></script>
```

- [ ] **Step 3: Actualizar los tres `accept` de inputs de imagen**

Línea 89 — avatar:
```html
<input type="file" id="avatar-input" accept="image/*" hidden>
```
→
```html
<input type="file" id="avatar-input" accept="image/*,image/heic,image/heif" hidden>
```

Línea 208 — galería:
```html
<input type="file" id="gallery-input" accept="image/*" multiple hidden>
```
→
```html
<input type="file" id="gallery-input" accept="image/*,image/heic,image/heif" multiple hidden>
```

Línea 456 — galería edit:
```html
<input type="file" id="gallery-edit-input" accept="image/*" multiple hidden>
```
→
```html
<input type="file" id="gallery-edit-input" accept="image/*,image/heic,image/heif" multiple hidden>
```

- [ ] **Step 4: Commit**

```bash
git add public/artist/dashboard/index.html
git commit -m "feat: load heic-converter CDN scripts in artist dashboard, update accept attributes"
```

---

## Task 3: Configurar HTML de Cotizaciones y Job Board

**Files:**
- Modify: `public/quotation/index.html`
- Modify: `public/job-board/request/index.html`

- [ ] **Step 1: Agregar CDN scripts en `<head>` de cotizaciones (línea 26)**

Localizar:
```html
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js"></script>
```

Cambiar a:
```html
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js"></script>
```

- [ ] **Step 2: Actualizar el `accept` del input de imágenes en cotizaciones (línea 285)**

Localizar en `public/quotation/index.html` (dentro de `<template id="tmpl-file-upload">`):
```html
<input type="file" id="file-input" multiple accept="image/*" class="hidden">
```
Cambiar a:
```html
<input type="file" id="file-input" multiple accept="image/*,image/heic,image/heif" class="hidden">
```

- [ ] **Step 3: Agregar `heic-converter.js` antes de `script.js` (fondo del body de cotizaciones, ~línea 381)**

Localizar:
```html
    <script src="/shared/js/client-auth.js"></script>
    <script src="/shared/js/script.js"></script>
```

Cambiar a:
```html
    <script src="/shared/js/client-auth.js"></script>
    <script src="/shared/js/heic-converter.js"></script>
    <script src="/shared/js/script.js"></script>
```

- [ ] **Step 4: Agregar CDN scripts en `<head>` de job board request (línea 21)**

Localizar en `public/job-board/request/index.html`:
```html
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="/shared/js/config-manager.js"></script>
```

Cambiar a:
```html
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js"></script>
    <script src="/shared/js/config-manager.js"></script>
```

- [ ] **Step 5: Agregar `heic-converter.js` antes de `job-board-request.js` (línea 114)**

Localizar:
```html
    <script src="/shared/js/job-board-request.js"></script>
```

Cambiar a:
```html
    <script src="/shared/js/heic-converter.js"></script>
    <script src="/shared/js/job-board-request.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add public/quotation/index.html public/job-board/request/index.html
git commit -m "feat: load heic-converter CDN scripts in quotation and job board pages, update accept attrs"
```

---

## Task 4: Integrar conversión en `dashboard.js` (Avatar + Galería)

**Files:**
- Modify: `public/shared/js/dashboard.js`

Tres funciones a reemplazar: `handleAvatarUpload` (línea 1154), `handleGalleryUpload` (línea 1245), `handleGalleryEditUpload` (línea 1963).

- [ ] **Step 1: Reemplazar `handleAvatarUpload` (líneas 1154–1230)**

```javascript
async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Permitir HEIC (file.type puede estar vacío en Chrome/Firefox para HEIC)
    const isImage = file.type.startsWith('image/') || isHEICFile(file);
    if (!isImage) {
        showStatusMessage('Por favor selecciona una imagen.', 'error');
        return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB pre-compresión; se comprime a ≤1MB
        showStatusMessage('La imagen es muy grande. Maximo 10MB.', 'error');
        return;
    }

    const loadingEl = document.getElementById('avatar-loading');
    loadingEl.classList.add('active');

    const queue = new UploadQueue(
        async (processedFile) => {
            const fileExt = processedFile.name.split('.').pop();
            const fileName = `${Date.now()}.${fileExt}`;
            const filePath = `${currentUser.id}/${fileName}`;

            const { error: uploadError } = await _supabase.storage
                .from('profile-pictures')
                .upload(filePath, processedFile, { cacheControl: '3600', upsert: true });

            if (uploadError) {
                if (uploadError.message.includes('Bucket not found') || uploadError.message.includes('not found')) {
                    showStatusMessage('El almacenamiento de fotos no esta configurado. Contacta al administrador.', 'error');
                    return;
                }
                throw uploadError;
            }

            const { data: urlData } = _supabase.storage.from('profile-pictures').getPublicUrl(filePath);
            const publicUrl = urlData.publicUrl;

            const { error: updateError } = await _supabase
                .from('artists_db')
                .update({ profile_picture: publicUrl })
                .eq('user_id', currentUser.id);

            if (updateError) throw updateError;

            const avatarImg = document.getElementById('avatar-image');
            avatarImg.src = publicUrl;
            avatarImg.classList.add('loaded');
            artistData.profile_picture = publicUrl;
            showStatusMessage('Foto de perfil actualizada.', 'success');
            checkProfileCompletion();
        },
        () => {},
        (file, err) => {
            console.error('Error uploading avatar:', err);
            showStatusMessage('Error al subir la imagen.', 'error');
        }
    );

    try {
        await queue.addFiles([file]);
    } catch (error) {
        console.error('Error uploading avatar:', error);
        showStatusMessage('Error al subir la imagen.', 'error');
    } finally {
        loadingEl.classList.remove('active');
        e.target.value = '';
    }
}
```

- [ ] **Step 2: Reemplazar `handleGalleryUpload` (líneas 1245–1324)**

```javascript
async function handleGalleryUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const currentImages = artistData.gallery_images || [];
    const remainingSlots = MAX_GALLERY_IMAGES - currentImages.length;

    if (files.length > remainingSlots) {
        showStatusMessage(`Solo puedes subir ${remainingSlots} imagenes mas (max ${MAX_GALLERY_IMAGES}).`, 'error');
        e.target.value = '';
        return;
    }

    for (const file of files) {
        const isImage = file.type.startsWith('image/') || isHEICFile(file);
        if (!isImage) {
            showStatusMessage('Solo se permiten archivos de imagen.', 'error');
            e.target.value = '';
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showStatusMessage('Las imagenes no pueden superar los 10MB.', 'error');
            e.target.value = '';
            return;
        }
    }

    const loadingEl = document.getElementById('gallery-admin-loading');
    loadingEl.style.display = 'flex';

    const uploadedUrls = [];

    const queue = new UploadQueue(
        async (processedFile) => {
            const fileExt = processedFile.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
            const filePath = `${currentUser.id}/${fileName}`;

            const { error: uploadError } = await _supabase.storage
                .from('artist-gallery')
                .upload(filePath, processedFile, { cacheControl: '3600', upsert: false });

            if (uploadError) {
                console.error('Upload error:', uploadError);
                return;
            }

            const { data: urlData } = _supabase.storage.from('artist-gallery').getPublicUrl(filePath);
            uploadedUrls.push(urlData.publicUrl);
        },
        (current, total) => {
            const pEl = loadingEl.querySelector('p');
            if (pEl) pEl.textContent = `Subiendo ${current}/${total}...`;
        },
        (file, err) => { console.error('Gallery upload error:', err); }
    );

    try {
        await queue.addFiles(files);

        if (uploadedUrls.length > 0) {
            const newGalleryImages = [...(artistData.gallery_images || []), ...uploadedUrls];

            const { error: updateError } = await _supabase
                .from('artists_db')
                .update({ gallery_images: newGalleryImages })
                .eq('user_id', currentUser.id);

            if (updateError) throw updateError;

            artistData.gallery_images = newGalleryImages;
            renderGalleryAdmin();
            showStatusMessage(`${uploadedUrls.length} imagen(es) subida(s) correctamente.`, 'success');
        }
    } catch (error) {
        console.error('Error uploading gallery images:', error);
        showStatusMessage('Error al subir las imagenes.', 'error');
    } finally {
        loadingEl.style.display = 'none';
        e.target.value = '';
    }
}
```

- [ ] **Step 3: Reemplazar `handleGalleryEditUpload` (líneas 1963–2045)**

```javascript
async function handleGalleryEditUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const currentImages = artistData?.gallery_images || [];
    const remainingSlots = MAX_GALLERY_IMAGES - currentImages.length;

    if (files.length > remainingSlots) {
        showStatusMessage(`Solo puedes subir ${remainingSlots} imagenes mas (max ${MAX_GALLERY_IMAGES}).`, 'error');
        e.target.value = '';
        return;
    }

    for (const file of files) {
        const isImage = file.type.startsWith('image/') || isHEICFile(file);
        if (!isImage) {
            showStatusMessage('Solo se permiten archivos de imagen.', 'error');
            e.target.value = '';
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showStatusMessage('Las imagenes no pueden superar los 10MB.', 'error');
            e.target.value = '';
            return;
        }
    }

    const uploadBtn = document.querySelector('.gallery-edit-upload-btn span');
    const originalText = uploadBtn?.textContent;
    if (uploadBtn) uploadBtn.textContent = 'Subiendo...';

    const uploadedUrls = [];

    const queue = new UploadQueue(
        async (processedFile) => {
            const fileExt = processedFile.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
            const filePath = `${currentUser.id}/${fileName}`;

            const { error: uploadError } = await _supabase.storage
                .from('artist-gallery')
                .upload(filePath, processedFile, { cacheControl: '3600', upsert: false });

            if (uploadError) {
                console.error('Upload error:', uploadError);
                return;
            }

            const { data: urlData } = _supabase.storage.from('artist-gallery').getPublicUrl(filePath);
            uploadedUrls.push(urlData.publicUrl);
        },
        (current, total) => {
            if (uploadBtn) uploadBtn.textContent = `Subiendo ${current}/${total}...`;
        },
        (file, err) => { console.error('Gallery edit upload error:', err); }
    );

    try {
        await queue.addFiles(files);

        if (uploadedUrls.length > 0) {
            const newGalleryImages = [...(artistData?.gallery_images || []), ...uploadedUrls];

            const { error: updateError } = await _supabase
                .from('artists_db')
                .update({ gallery_images: newGalleryImages })
                .eq('user_id', currentUser.id);

            if (updateError) throw updateError;

            artistData.gallery_images = newGalleryImages;
            renderGalleryEditPreview();
            renderGalleryAdmin();
            showStatusMessage(`${uploadedUrls.length} imagen(es) subida(s) correctamente.`, 'success');
        }
    } catch (error) {
        console.error('Error uploading gallery images:', error);
        showStatusMessage('Error al subir las imagenes.', 'error');
    } finally {
        if (uploadBtn) uploadBtn.textContent = originalText || 'Subir Imagenes';
        e.target.value = '';
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add public/shared/js/dashboard.js
git commit -m "feat: integrate UploadQueue into dashboard upload handlers with HEIC + compression support"
```

---

## Task 5: Integrar conversión en `script.js` (Cotizaciones)

**Files:**
- Modify: `public/shared/js/script.js`

El upload es **diferido**. `handleFiles` convierte y comprime antes de agregar a `uploadedFiles[]`. La función `uploadReferencesToStorage` no se modifica.

- [ ] **Step 1: Reemplazar `handleFiles` (líneas 2822–2837)**

```javascript
async function handleFiles(files) {
    const remainingSlots = 4 - uploadedFiles.length;
    if (remainingSlots <= 0) {
        showToastMessage("Máximo 4 imágenes de referencia permitidas.");
        return;
    }

    const filesArray = Array.from(files).slice(0, remainingSlots);
    if (filesArray.length < files.length) {
        showToastMessage("Solo se agregaron las primeras 4 imágenes.");
    }

    // Convertir y comprimir cada archivo antes de agregar a la lista.
    // handleFiles es async — el caller (input.onchange) no necesita awaitar.
    const processedFiles = [];
    for (const file of filesArray) {
        const converted = await convertIfHEIC(file);
        const compressed = await compressImage(converted);
        processedFiles.push(compressed);
    }

    uploadedFiles = [...uploadedFiles, ...processedFiles];
    formData.reference_images_count = uploadedFiles.length;
    renderPreviews();
}
```

- [ ] **Step 2: Verificar que `uploadReferencesToStorage` usa `file.type` para el MIME**

Buscar `uploadReferencesToStorage` en `script.js` y confirmar que pasa `file.type` (o `mimeType: file.type`) al subir a Supabase. Los archivos ya convertidos tendrán `type: 'image/jpeg'` correctamente — no se requiere ningún cambio.

- [ ] **Step 3: Commit**

```bash
git add public/shared/js/script.js
git commit -m "feat: convert and compress HEIC images in quotation handleFiles before deferring upload"
```

---

## Task 6: Integrar conversión en `job-board-request.js`

**Files:**
- Modify: `public/shared/js/job-board-request.js`

Tres cambios: `ACCEPTED_IMAGE_TYPES`, `accept=` en `renderColorRefs`, función `addFiles`.

- [ ] **Step 1: Actualizar `ACCEPTED_IMAGE_TYPES` (línea 31)**

```javascript
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
// Nota: '' (tipo vacío para HEIC en Chrome/Firefox) ya no es necesario porque
// convertIfHEIC corre antes de la validación y produce 'image/jpeg'.
```

- [ ] **Step 2: Actualizar el atributo `accept` dentro de `renderColorRefs` (línea 595)**

Localizar:
```javascript
<input type="file" id="jb-file-input" accept="image/jpeg,image/png,image/webp" multiple style="display:none" onchange="handleFileSelect(event)">
```
Cambiar a:
```javascript
<input type="file" id="jb-file-input" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple style="display:none" onchange="handleFileSelect(event)">
```

- [ ] **Step 3: Reemplazar `addFiles` (líneas 640–661)**

```javascript
async function addFiles(files) {
    const remaining = MAX_FILES - uploadedFiles.length;
    if (remaining <= 0) {
        showFormNotice('Maximo ' + MAX_FILES + ' imagenes permitidas');
        return;
    }

    const filesToProcess = Array.from(files).slice(0, remaining);

    for (const file of filesToProcess) {
        // Convertir y comprimir ANTES de validar tipo y tamaño
        const converted = await convertIfHEIC(file);
        const compressed = await compressImage(converted);

        if (!ACCEPTED_IMAGE_TYPES.includes(compressed.type)) {
            showFormNotice('Solo se permiten imagenes JPG, PNG o WebP');
            continue;
        }
        if (compressed.size > MAX_FILE_SIZE) {
            showFormNotice('El archivo ' + file.name + ' supera los 5MB tras compresion');
            continue;
        }

        uploadedFiles.push(compressed);
    }

    renderFilePreviews();
}
```

**Nota:** `addFiles` pasa de síncrona a `async`. Sus callers (`handleFileSelect`, `handleDrop`) no dependen del valor de retorno — el comportamiento es correcto.

- [ ] **Step 4: Commit**

```bash
git add public/shared/js/job-board-request.js
git commit -m "feat: add HEIC support to job board addFiles with conversion, compression and type guard update"
```

---

## Task 7: Verificación smoke test

No hay framework de tests en este proyecto. Verificar manualmente:

- [ ] **Step 1: Sin errores de consola al cargar cada página**

Abrir en el navegador:
- `http://localhost:PORT/artist/dashboard/`
- `http://localhost:PORT/quotation/`
- `http://localhost:PORT/job-board/request/`

En DevTools → Console verificar que NO aparece:
- `heic2any is not defined`
- `imageCompression is not defined`
- `convertIfHEIC is not defined`
- `UploadQueue is not defined`

- [ ] **Step 2: Test de regresión con JPEG normal**

En cada punto de upload, subir una imagen JPEG. Verificar:
- Preview aparece correctamente
- Sube a Supabase sin errores
- El archivo en storage tiene extensión `.jpg` y tipo `image/jpeg`

- [ ] **Step 3: Test de cola multi-imagen en galería**

Seleccionar 3 imágenes a la vez en la galería del dashboard. Verificar:
- El progreso cambia (`Subiendo 1/3...`, `2/3...`, `3/3...`)
- Las 3 imágenes aparecen en la galería al terminar
- No hay uploads duplicados

- [ ] **Step 4: Commit de cierre**

```bash
git add -A
git commit -m "feat: HEIC image compatibility complete — all 4 upload points updated"
```

---

## Notas de implementación

- **`isHEICFile` es global en el browser** — `heic-converter.js` se carga síncronamente antes que `dashboard.js`, `script.js` y `job-board-request.js`. No hay `import`/`export`; todas las funciones y la clase son globales en el scope del browser.
- **Límite de tamaño sube de 5MB a 10MB pre-compresión** — `compressImage` reduce a ≤1MB. Intencional.
- **`addFiles` y `handleFiles` pasan a `async`** — sus callers usan eventos DOM (`onchange`, `ondrop`) que no dependen del retorno. El flujo es correcto.
- **`UploadQueue.done`** es una Promise que resuelve cuando todos los archivos terminan. Usada con `await queue.addFiles(files)` en los handlers del dashboard. Esto elimina el need de polling.
