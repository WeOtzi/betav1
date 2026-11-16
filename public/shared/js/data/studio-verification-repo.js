/**
 * WE OTZI - Verificación del estudio (frontend)
 * ---------------------------------------------
 * Figma de estudios 91wYIpURj0xn0kzqhybOOt · 05 Verificación del estudio
 * (E-VER-01/02/03). Migración 20261115220000_studio_verification_documents:
 *   - Bucket privado `studio-verification`, ruta `<studio_id>/<archivo>`.
 *     El dueño sube y lee lo suyo; soporte lee todo. Sin UPDATE/DELETE.
 *   - RPC submit_studio_verification(p_studio_id, p_payload jsonb).
 * El estado completo (estudio, sedes, última solicitud, Instagram) y las URLs
 * firmadas los da el servidor: GET /api/studio/verification[/documents].
 *
 * Expone WeotziData.StudioVerification { BUCKET, MAX_BYTES, KINDS, accept,
 * validate, upload, submit }. Carga: postgrest-client.js primero.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.getClient !== 'function') {
        console.error('[studio-verification-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    const BUCKET = 'studio-verification';
    const MAX_BYTES = 10 * 1024 * 1024;
    // Mismos formatos que el bucket (allowed_mime_types).
    const KINDS = {
        representation: { types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], ext: /\.(pdf|jpe?g|png|webp)$/i, label: 'PDF, JPG, PNG o WEBP' },
        space: { types: ['image/jpeg', 'image/png', 'image/webp'], ext: /\.(jpe?g|png|webp)$/i, label: 'JPG, PNG o WEBP' }
    };

    function storage() {
        const client = D.getClient();
        if (!client || !client.storage) throw new Error('No pudimos conectar con el almacenamiento. Recarga la página.');
        return client.storage.from(BUCKET);
    }

    function safeName(name) {
        return String(name || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'archivo';
    }

    function accept(kind) {
        return (KINDS[kind] || KINDS.representation).types.join(',');
    }

    function validate(file, kind) {
        const rule = KINDS[kind] || KINDS.representation;
        if (!file) return 'Elige un archivo.';
        const typeOk = file.type ? rule.types.indexOf(file.type) !== -1 : rule.ext.test(file.name || '');
        if (!typeOk) return 'Formato no admitido. Sube ' + rule.label + '.';
        if (file.size > MAX_BYTES) return 'El archivo pesa más de 10 MB.';
        if (file.size === 0) return 'El archivo está vacío.';
        return null;
    }

    const StudioVerification = {
        BUCKET,
        MAX_BYTES,
        KINDS: Object.keys(KINDS),
        accept,
        validate,

        // Sube un archivo y devuelve el descriptor que espera la RPC.
        async upload(file, { studioId, kind }) {
            const problem = validate(file, kind);
            if (problem) throw new Error(problem);
            if (!studioId) throw new Error('No encontramos tu estudio. Recarga la página.');
            const path = studioId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + safeName(file.name);
            const { error } = await storage().upload(path, file, {
                cacheControl: '3600', upsert: false, contentType: file.type || undefined
            });
            if (error) throw Object.assign(new Error(error.message || 'No se pudo subir el archivo.'), { cause: error });
            return { kind, path, name: String(file.name || 'archivo').slice(0, 200), mime: file.type || '', size: file.size || null };
        },

        // RPC submit_studio_verification → { data: requestId, error }.
        submit(studioId, payload) {
            return D.getClient().rpc('submit_studio_verification', {
                p_studio_id: studioId,
                p_payload: payload || {}
            });
        }
    };

    D.StudioVerification = StudioVerification;
})();
