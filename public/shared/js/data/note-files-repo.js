/**
 * WE OTZI - Imágenes de las notas de trabajo (Storage privado)
 * ------------------------------------------------------------
 * Figma 801:578 / 801:579 · bloque IMAGEN de las notas de trabajo (ronda 3,
 * P16). Bucket privado `quotation-note-files` (migración 20261112180000):
 * ruta `<artist_id>/<quotation_id>/<archivo>`; el artista dueño de la
 * cotización sube, lee y borra; soporte lee; el cliente nunca las ve.
 *
 * Expone WeotziData.NoteFiles { BUCKET, MAX_BYTES, ACCEPT, validate, upload,
 * signedUrl, remove }. Carga: postgrest-client.js primero.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.getClient !== 'function') {
        console.error('[note-files-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    const BUCKET = 'quotation-note-files';
    const MAX_BYTES = 10 * 1024 * 1024;
    const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'];
    const SIGNED_TTL = 3600;
    const signedCache = new Map(); // path → { url, exp }
    // Preview local / modo demo: no hay Storage; la imagen vive como blob: URL
    // hasta recargar (nada se sube).
    const previewFiles = new Map();
    function isPreview() {
        return window.WEOTZI_PREVIEW === true || !!(window.WoDemo && window.WoDemo.enabled);
    }

    function storage() {
        const client = D.getClient();
        if (!client || !client.storage) throw new Error('Storage no disponible.');
        return client.storage.from(BUCKET);
    }

    function safeName(name) {
        return String(name || 'imagen').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'imagen';
    }

    // Mismo tope y formatos que el bucket (file_size_limit / allowed_mime_types).
    function validate(file) {
        if (!file) return 'Elegí una imagen.';
        if (file.type && TYPES.indexOf(file.type) === -1) return 'Formato no admitido. Subí JPG, PNG, WEBP, GIF o HEIC.';
        if (!file.type && !/\.(jpe?g|png|webp|gif|heic)$/i.test(file.name || '')) return 'Formato no admitido. Subí JPG, PNG, WEBP, GIF o HEIC.';
        if (file.size > MAX_BYTES) return 'La imagen pesa más de 10 MB.';
        return null;
    }

    const NoteFiles = {
        BUCKET,
        MAX_BYTES,
        ACCEPT: TYPES.join(','),
        validate,

        async upload(file, { artistId, quotationId }) {
            const problem = validate(file);
            if (problem) throw new Error(problem);
            if (!artistId || quotationId == null) throw new Error('Falta la cotización de la nota.');
            const path = `${artistId}/${quotationId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(file.name)}`;
            if (isPreview()) {
                previewFiles.set(path, URL.createObjectURL(file));
                return path;
            }
            const { error } = await storage().upload(path, file, {
                cacheControl: '3600', upsert: false, contentType: file.type || undefined,
            });
            if (error) throw Object.assign(new Error(error.message || 'No se pudo subir la imagen.'), { cause: error });
            return path;
        },

        // URL firmada (1 h, cacheada hasta 5 min antes de vencer); null si no
        // se puede firmar.
        async signedUrl(path) {
            const key = String(path || '');
            if (!key) return null;
            if (previewFiles.has(key)) return previewFiles.get(key);
            if (isPreview()) return null;
            const hit = signedCache.get(key);
            if (hit && hit.exp > Date.now()) return hit.url;
            try {
                const { data, error } = await storage().createSignedUrl(key, SIGNED_TTL);
                const url = error ? null : (data && data.signedUrl) || null;
                if (url) signedCache.set(key, { url, exp: Date.now() + (SIGNED_TTL - 300) * 1000 });
                return url;
            } catch (_) {
                return null;
            }
        },

        // Borrado best-effort (un archivo huérfano no debe frenar la nota).
        async remove(paths) {
            const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean).map(String);
            if (!list.length) return;
            list.forEach((p) => {
                signedCache.delete(p);
                if (previewFiles.has(p)) { URL.revokeObjectURL(previewFiles.get(p)); previewFiles.delete(p); }
            });
            if (isPreview()) return;
            try {
                const { error } = await storage().remove(list);
                if (error) console.warn('[note-files] remove', error);
            } catch (error) {
                console.warn('[note-files] remove', error);
            }
        },
    };

    D.NoteFiles = NoteFiles;
})();
