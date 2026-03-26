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
        this._onProgress(this._processed, this._total);

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
