// Registration photos stay on this browser until the confirmed account owns a studio.
// Only blobs and upload progress are stored here; account passwords never enter this store.
(function () {
    'use strict';
    const MAX_BYTES = 5 * 1024 * 1024;
    const MAX_GALLERY = 8;
    const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const basePath = window.WEOTZI_BASE_PATH || (window.location.pathname.startsWith('/beta/') ? '/beta' : '');
    const databaseName = 'weotzi-studio-registration-media:' + basePath;
    const finishing = new Map();
    let database;

    function emailKey(email) {
        const value = String(email || '').trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(value)) throw new Error('Escribí un email válido para guardar las fotos.');
        return value;
    }
    function validate(files) {
        const gallery = Array.from(files?.gallery || []);
        if (gallery.length > MAX_GALLERY) throw new Error('Podés agregar hasta 8 fotos a la galería.');
        const selected = [files?.cover, files?.logo, ...gallery].filter(Boolean);
        selected.forEach(file => {
            if (!TYPES.has(file.type)) throw new Error('Elegí imágenes JPG, PNG o WebP.');
            if (!file.size || file.size > MAX_BYTES) throw new Error('Cada imagen debe pesar entre 1 byte y 5 MB.');
            if (typeof file.arrayBuffer !== 'function') throw new Error('No pudimos leer una de las imágenes. Seleccionala nuevamente.');
        });
        return selected.length;
    }
    function openDatabase() {
        if (!window.indexedDB) return Promise.reject(new Error('Este navegador no permite guardar las fotos. Habilitá el almacenamiento o continuá sin imágenes.'));
        if (!database) database = new Promise((resolve, reject) => {
            const request = window.indexedDB.open(databaseName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'email' });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => { database = null; reject(new Error('No pudimos guardar las fotos en este navegador.')); };
            request.onblocked = () => { database = null; reject(new Error('Cerrá las otras pestañas de registro y volvé a intentar.')); };
        });
        return database;
    }
    async function transaction(mode, action) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('drafts', mode);
            const request = action(tx.objectStore('drafts'));
            let result;
            request.onsuccess = () => { result = request.result; };
            tx.oncomplete = () => resolve(result);
            tx.onerror = tx.onabort = () => reject(new Error('No pudimos guardar el progreso de las fotos. Revisá el espacio del navegador y reintentá.'));
        });
    }
    const read = email => transaction('readonly', store => store.get(emailKey(email)));
    const write = draft => transaction('readwrite', store => store.put(draft));
    async function clear(email) {
        if (!window.indexedDB) return;
        return transaction('readwrite', store => store.delete(emailKey(email)));
    }
    async function hasPending(email) {
        if (!window.indexedDB) return false;
        return !!(await read(email))?.items?.length;
    }
    async function load(email) {
        const files = { cover: null, logo: null, gallery: [] };
        if (!window.indexedDB) return files;
        const draft = await read(email);
        (draft?.items || []).forEach(item => {
            if (item.slot === 'gallery') files.gallery.push(item.file);
            else if (item.slot === 'cover' || item.slot === 'logo') files[item.slot] = item.file;
        });
        return files;
    }
    async function stage(email, files) {
        const count = validate(files);
        if (!count) { await clear(email); return; }
        const key = emailKey(email);
        const previous = await read(key);
        const entries = [];
        if (files.cover) entries.push({ slot: 'cover', file: files.cover });
        if (files.logo) entries.push({ slot: 'logo', file: files.logo });
        Array.from(files.gallery || []).forEach(file => entries.push({ slot: 'gallery', file }));
        const fingerprint = item => [item.slot, item.file.name, item.file.size, item.file.type, item.file.lastModified].join(':');
        const items = entries.map(entry => {
            const old = previous?.items?.find(item => fingerprint(item) === fingerprint(entry));
            return { ...entry, uploaded: old?.uploaded || null };
        });
        await write({ email: key, items, savedAt: Date.now() });
    }
    async function finishFiles(studio, email) {
        const key = emailKey(email);
        const draft = await read(key);
        if (!draft?.items?.length) return studio;
        const client = window.WeotziData?.getClient?.() || window._supabase;
        if (!client) throw new Error('No pudimos conectar para subir las fotos.');
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        const owner = data?.session?.user;
        if (!owner || emailKey(owner.email) !== key || studio.user_id !== owner.id) {
            throw new Error('Iniciá sesión con la cuenta del estudio para subir sus fotos.');
        }
        if (!window.WeOtziUploader?.uploadFile) throw new Error('No pudimos cargar el gestor de imágenes. Recargá y volvé a intentar.');
        for (const item of draft.items) {
            if (item.uploaded) continue;
            validate({ [item.slot === 'gallery' ? 'gallery' : item.slot]: item.slot === 'gallery' ? [item.file] : item.file });
            item.uploaded = await window.WeOtziUploader.uploadFile({
                supabase: client, bucket: 'studio-photos', file: item.file, pathPrefix: studio.id + '/registration'
            });
            if (!item.uploaded?.publicUrl) throw new Error('La imagen se subió, pero no pudimos obtener su enlace. Reintentá.');
            await write(draft);
        }
        const patch = {};
        const cover = draft.items.find(item => item.slot === 'cover');
        const logo = draft.items.find(item => item.slot === 'logo');
        if (cover) patch.cover_image = cover.uploaded.publicUrl;
        if (logo) patch.logo_image = logo.uploaded.publicUrl;
        const gallery = draft.items.filter(item => item.slot === 'gallery');
        if (gallery.length) {
            const photos = Array.isArray(studio.photo_feed_items) ? studio.photo_feed_items.slice() : [];
            gallery.forEach(item => {
                if (!photos.some(photo => photo.url === item.uploaded.publicUrl)) photos.push({
                    url: item.uploaded.publicUrl, kind: 'image', category: 'studio', sort: photos.length,
                    created_at: new Date().toISOString()
                });
            });
            patch.photo_feed_items = photos;
        }
        // select + single verifies that RLS allowed the profile update, rather than treating 0 rows as success.
        const result = await window.WeotziData.Studios.update(studio.id, patch).select('id').single();
        if (result.error) throw result.error;
        if (!result.data?.id) throw new Error('No pudimos guardar las imágenes en el perfil del estudio.');
        await clear(key);
        return { ...studio, ...patch };
    }
    async function finish(studio, email) {
        const key = emailKey(email);
        if (finishing.has(key)) return finishing.get(key);
        const pending = finishFiles(studio, key);
        finishing.set(key, pending);
        try { return await pending; } finally { finishing.delete(key); }
    }
    window.WeOtziStudioMedia = { stage, finish, hasPending, load, clear, validate, MAX_BYTES, MAX_GALLERY };
})();
