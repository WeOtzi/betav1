// ============================================================================
// We Ötzi · Buscador «¿Dónde está este diseño?» (fase 2 · /buscar-diseno)
// ----------------------------------------------------------------------------
// La persona (con sesión) sube una foto; el navegador la pasa a JPEG de hasta
// 1600 px (HEIC con heic-converter.js) y la manda como cuerpo binario a
// POST /api/disenos/buscar (lib/routes/disenos.js). El servidor calcula la
// huella en memoria, la descarta y devuelve hasta 12 coincidencias.
// En cada resultado, «Denunciar plagio» y «Es una suplantación» abren
// window.WoReport.open({ kind, id, label, reason, item, file, context }): recién
// ahí la foto se sube como evidencia (bucket privado support-attachments).
// Datos: WeotziData.Designs.search (solo el endpoint del servidor; nada de PostgREST directo).
// En Node (tests) solo exporta los helpers puros.
// ============================================================================

(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (root && root.document && !root.__bdBooted) {
        root.__bdBooted = true;
        root.BuscarDiseno = api;
        api.boot();
    }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    // ---------------------------------------------------------------
    // Constantes
    // ---------------------------------------------------------------
    const ENDPOINT = '/api/disenos/buscar';
    const PAGE_PATH = '/buscar-diseno';
    const MAX_BYTES = 10 * 1024 * 1024;
    const MAX_SIDE = 1600;
    const JPEG_QUALITY = 0.9;
    const SEND_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    const EXT_KINDS = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', heic: 'heic', heif: 'heic' };
    const TYPE_KINDS = { 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic' };
    const PORTFOLIO_KINDS = ['artist_gallery', 'flash', 'studio_feed'];
    const REPORT_REASONS = { plagio: 'plagio_diseno', suplantacion: 'suplantacion_identidad' };
    const CONFIDENCE = {
        casi_segura: { label: 'Casi segura', hint: 'Es la misma foto o una copia casi exacta.' },
        posible: { label: 'Posible', hint: 'Parece una copia con cambios menores.' },
        parecida: { label: 'Parecida', hint: 'Se parece: revísala con atención.' }
    };
    const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    const MSG = {
        fileType: 'Elige una imagen JPG, PNG, WebP o HEIC.',
        fileSize: 'La imagen puede pesar hasta 10 MB.',
        fileEmpty: 'El archivo está vacío.',
        heic: 'No pudimos convertir la foto HEIC. Expórtala como JPG desde tu teléfono y vuelve a intentarlo.',
        preparing: 'Preparando la foto…',
        searching: 'Buscando en We Ötzi…',
        offline: 'No pudimos conectar con We Ötzi. Revisa tu conexión e inténtalo de nuevo.',
        generic: 'No pudimos completar la búsqueda. Inténtalo de nuevo en unos minutos.',
        login: 'Inicia sesión para buscar un diseño.',
        unavailable: 'El buscador se habilita pronto.',
        emptyTitle: 'No encontramos copias dentro de We Ötzi',
        emptyText: 'Eso no garantiza que no exista: el buscador todavía no encuentra diseños redibujados ni fotos muy editadas.',
        reportUnavailable: 'No pudimos abrir la denuncia. Recarga la página e inténtalo de nuevo.',
        disclaimer: 'Que dos diseños se parezcan no prueba un plagio: soporte revisa cada caso.'
    };

    // ---------------------------------------------------------------
    // Helpers puros
    // ---------------------------------------------------------------
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 'jpeg' | 'png' | 'webp' | 'heic' | null (por tipo o, si viene vacío, por extensión)
    function fileKind(file) {
        if (!file) return null;
        const type = String(file.type || '').toLowerCase();
        if (TYPE_KINDS[type]) return TYPE_KINDS[type];
        const ext = String(file.name || '').split('.').pop().toLowerCase();
        return EXT_KINDS[ext] || null;
    }

    function validateFile(file) {
        if (!file) return { error: MSG.fileType };
        if (!fileKind(file)) return { error: MSG.fileType };
        const size = Number(file.size);
        if (!size) return { error: MSG.fileEmpty };
        if (size > MAX_BYTES) return { error: MSG.fileSize };
        return { ok: true, kind: fileKind(file) };
    }

    // Lado mayor ≤ max, sin agrandar.
    function scaleSize(width, height, max) {
        const w = Math.max(1, Math.round(Number(width) || 1));
        const h = Math.max(1, Math.round(Number(height) || 1));
        const limit = Number(max) || MAX_SIDE;
        const ratio = Math.min(1, limit / Math.max(w, h));
        return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
    }

    function confidenceInfo(code) {
        return CONFIDENCE[code] || { label: '', hint: '' };
    }

    // '2026-11-18T…' → '18 de noviembre de 2026'
    function fmtDate(iso) {
        const d = new Date(iso || '');
        if (isNaN(d.getTime())) return '';
        return d.getDate() + ' de ' + MONTHS[d.getMonth()] + ' de ' + d.getFullYear();
    }

    function limitText(remaining) {
        const n = Number(remaining);
        if (!isFinite(n)) return '';
        if (n <= 0) return 'No te quedan búsquedas por hoy. Prueba de nuevo mañana.';
        return n === 1 ? 'Te queda 1 búsqueda hoy.' : 'Te quedan ' + n + ' búsquedas hoy.';
    }

    function safeHttps(url) {
        try {
            const u = new URL(String(url || '').trim());
            return u.protocol === 'https:' ? u.href : '';
        } catch (_) {
            return '';
        }
    }

    function authLinks(base, returnTo) {
        const back = encodeURIComponent(String(returnTo || PAGE_PATH));
        const b = base || '';
        return {
            login: b + '/client/login?returnTo=' + back,
            register: b + '/client/register?returnTo=' + back,
            artistLogin: b + '/artist/login?returnTo=' + back
        };
    }

    // Clave del ítem en el formato de las denuncias (id del ítem o nombre del
    // archivo como está en la URL del perfil). La arma el servidor
    // (report_key); si no llega, se deduce del item_key o de la URL.
    function reportKey(r) {
        if (r.report_key) return String(r.report_key).slice(0, 120);
        const base = String(r.item_key || '').replace(/^(?:artist|studio):[^|]*\|/, '');
        if (base.indexOf('id:') === 0) return base.slice(3).slice(0, 120);
        const url = String(r.report_image_url || r.image_url || '').split('#')[0].split('?')[0];
        return (url.split('/').pop() || '').slice(0, 120);
    }

    // Opciones de WoReport.open para un resultado. kind: 'plagio' | 'suplantacion'.
    function reportOptions(result, file, kind) {
        const r = result || {};
        const owner = r.owner || {};
        if (owner.kind !== 'artist' && owner.kind !== 'studio') return null;
        if (!owner.id) return null;
        const reason = REPORT_REASONS[kind];
        if (!reason) return null;
        const options = {
            kind: owner.kind,
            id: String(owner.id),
            label: String(owner.name || ''),
            reason: reason,
            context: 'buscador: distancia ' + (r.distance == null ? '?' : r.distance)
        };
        if (PORTFOLIO_KINDS.indexOf(r.source_kind) >= 0 && (r.item_key || r.image_url)) {
            // La URL y la clave como las guarda el perfil: así la denuncia
            // encuentra la foto (lib/denuncias.js findPortfolioItem).
            options.item = { key: reportKey(r), image: safeHttps(r.report_image_url || r.image_url) };
        }
        if (file) options.file = file;
        return options;
    }

    function resultHtml(result, index, base) {
        const r = result || {};
        const owner = r.owner || {};
        const conf = confidenceInfo(r.confidence);
        const img = safeHttps(r.image_url);
        const profile = owner.profile_url ? (base || '') + owner.profile_url : '';
        const handle = owner.username ? '@' + owner.username : '';
        const kindLabel = owner.kind === 'studio' ? 'Estudio' : 'Artista';
        const when = fmtDate(r.first_seen_at);
        const titleId = 'bd-result-' + index;
        return '<li class="bd-card" data-bd-index="' + index + '">'
            + '<div class="bd-card-media">'
            + (img ? '<img src="' + esc(img) + '" alt="' + esc('Foto publicada por ' + (owner.name || kindLabel)) + '" loading="lazy" referrerpolicy="no-referrer">'
                : '<span class="bd-card-noimg">Sin vista previa</span>')
            + (conf.label ? '<span class="bd-conf bd-conf--' + esc(r.confidence) + '">' + esc(conf.label) + '</span>' : '')
            + '</div>'
            + '<div class="bd-card-body">'
            + '<p class="bd-card-kind">' + esc(kindLabel) + '</p>'
            + '<h3 class="bd-card-title" id="' + titleId + '">'
            + (profile ? '<a href="' + esc(profile) + '">' + esc(owner.name || kindLabel) + '</a>' : esc(owner.name || kindLabel))
            + '</h3>'
            + (handle ? '<p class="bd-card-handle">' + esc(handle) + '</p>' : '')
            + (when ? '<p class="bd-card-date">Subido a We Ötzi el ' + esc(when) + '</p>' : '')
            + (conf.hint ? '<p class="bd-card-hint">' + esc(conf.hint) + '</p>' : '')
            + '<div class="bd-card-actions">'
            + '<button type="button" class="wo-btn wo-btn--s bd-report" data-bd-report="plagio" data-bd-index="' + index + '" aria-describedby="' + titleId + '">Denunciar plagio</button>'
            + '<button type="button" class="wo-btn wo-btn--s wo-btn--ghost bd-report" data-bd-report="suplantacion" data-bd-index="' + index + '" aria-describedby="' + titleId + '">Es una suplantación</button>'
            + '</div>'
            + '</div>'
            + '</li>';
    }

    function resultsHtml(results, base) {
        const list = Array.isArray(results) ? results : [];
        if (!list.length) {
            return '<div class="bd-empty">'
                + '<h2 class="bd-h2" id="bd-results-title" tabindex="-1">' + esc(MSG.emptyTitle) + '</h2>'
                + '<p class="bd-text">' + esc(MSG.emptyText) + '</p>'
                + '</div>';
        }
        const title = list.length === 1 ? 'Encontramos 1 coincidencia' : 'Encontramos ' + list.length + ' coincidencias';
        return '<h2 class="bd-h2" id="bd-results-title" tabindex="-1">' + esc(title) + '</h2>'
            + '<p class="bd-text bd-disclaimer">' + esc(MSG.disclaimer) + ' Si una es tuya y la publicó otra persona, denúnciala y adjuntamos tu foto como evidencia.</p>'
            + '<ul class="bd-grid">' + list.map(function (r, i) { return resultHtml(r, i, base); }).join('') + '</ul>';
    }

    // Respuesta del servidor → mensaje para la persona.
    function errorFor(status, json) {
        const j = json || {};
        if (status === 0) return MSG.offline;
        if (status === 401) return MSG.login;
        if (status === 503) return j.error || MSG.unavailable;
        if (status === 500) return MSG.generic;
        return j.error || MSG.generic;
    }

    const pure = {
        ENDPOINT, MAX_BYTES, MAX_SIDE, PORTFOLIO_KINDS, REPORT_REASONS, CONFIDENCE, MSG,
        esc, fileKind, validateFile, scaleSize, confidenceInfo, fmtDate, limitText, safeHttps, authLinks,
        reportOptions, reportKey, resultHtml, resultsHtml, errorFor
    };

    if (!root || !root.document) return { boot: function () {}, _internal: pure };

    // ---------------------------------------------------------------
    // Navegador
    // ---------------------------------------------------------------
    const doc = root.document;
    const $ = function (id) { return doc.getElementById(id); };
    const state = { session: null, file: null, previewUrl: '', results: [], busy: false };

    function basePath() {
        if (root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const p = (root.location && root.location.pathname) || '';
        return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
    }

    async function getClient() {
        const CM = root.ConfigManager;
        if (CM && typeof CM.ready === 'function') {
            try {
                await Promise.race([CM.ready(), new Promise(function (resolve) { root.setTimeout(resolve, 8000); })]);
            } catch (_) { /* seguimos con lo que haya */ }
        }
        try {
            const D = root.WeotziData;
            if (D && typeof D.getClient === 'function') {
                const c = D.getClient();
                if (c) return c;
            }
        } catch (_) { /* probamos el siguiente */ }
        try {
            if (CM && typeof CM.getSupabaseClient === 'function') {
                const c = CM.getSupabaseClient();
                if (c) return c;
            }
        } catch (_) { /* sin cliente */ }
        return root._supabase || null;
    }

    async function getSession() {
        try {
            const client = await getClient();
            if (!client || !client.auth || typeof client.auth.getSession !== 'function') return null;
            const res = await client.auth.getSession();
            const s = res && res.data && res.data.session;
            return s && s.user && s.access_token ? s : null;
        } catch (_) {
            return null;
        }
    }

    // Capa de datos del buscador: un único endpoint del servidor.
    async function search(blob) {
        const s = await getSession();
        if (!s) return { ok: false, status: 401, json: { error: MSG.login } };
        try {
            const res = await root.fetch(basePath() + ENDPOINT, {
                method: 'POST',
                headers: { Accept: 'application/json', Authorization: 'Bearer ' + s.access_token, 'Content-Type': blob.type || 'image/jpeg' },
                body: blob,
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const json = await res.json().catch(function () { return {}; });
            return { ok: res.ok && !!(json && json.success), status: res.status, json: json || {} };
        } catch (_) {
            return { ok: false, status: 0, json: {} };
        }
    }

    function loadImage(url) {
        return new Promise(function (resolve, reject) {
            const img = new root.Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('decode')); };
            img.src = url;
        });
    }

    // JPEG de hasta 1600 px para ahorrar datos. Si el navegador no puede, se manda el original.
    async function downscale(file) {
        const url = root.URL.createObjectURL(file);
        try {
            const img = await loadImage(url);
            const size = scaleSize(img.naturalWidth || img.width, img.naturalHeight || img.height, MAX_SIDE);
            const canvas = doc.createElement('canvas');
            canvas.width = size.width;
            canvas.height = size.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('canvas');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size.width, size.height);
            ctx.drawImage(img, 0, 0, size.width, size.height);
            const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY); });
            if (!blob || !blob.size) throw new Error('blob');
            return blob;
        } finally {
            root.URL.revokeObjectURL(url);
        }
    }

    async function prepare(file) {
        let source = file;
        if (fileKind(file) === 'heic') {
            if (typeof root.convertIfHEIC !== 'function' || typeof root.heic2any !== 'function') throw new Error(MSG.heic);
            source = await root.convertIfHEIC(file);
            if (!source || fileKind(source) === 'heic') throw new Error(MSG.heic);
        }
        try {
            return await downscale(source);
        } catch (_) {
            if (SEND_TYPES.indexOf(String(source.type || '').toLowerCase()) >= 0 && source.size <= MAX_BYTES) return source;
            throw new Error(fileKind(file) === 'heic' ? MSG.heic : MSG.generic);
        }
    }

    function setStatus(text, kind) {
        const el = $('bd-status');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'bd-status' + (kind ? ' bd-status--' + kind : '');
        el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        el.hidden = !text;
    }

    function setLimit(remaining) {
        const el = $('bd-limit');
        if (!el) return;
        const text = limitText(remaining);
        el.textContent = text;
        el.hidden = !text;
    }

    function setBusy(busy) {
        state.busy = busy;
        const submit = $('bd-submit');
        if (submit) submit.disabled = busy;
        const change = $('bd-change');
        if (change) change.disabled = busy;
        const results = $('bd-results');
        if (results) results.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function showGate() {
        const links = authLinks(basePath(), PAGE_PATH);
        if ($('bd-login')) $('bd-login').href = links.login;
        if ($('bd-register')) $('bd-register').href = links.register;
        if ($('bd-artist-login')) $('bd-artist-login').href = links.artistLogin;
        $('bd-gate').hidden = false;
        $('bd-search').hidden = true;
        $('bd-results').hidden = true;
    }

    function showSearch() {
        $('bd-gate').hidden = true;
        $('bd-search').hidden = false;
    }

    function clearPreview() {
        if (state.previewUrl) { try { root.URL.revokeObjectURL(state.previewUrl); } catch (_) { /* nada */ } }
        state.previewUrl = '';
        const media = $('bd-preview-media');
        if (media) media.innerHTML = '';
    }

    function pickFile(file) {
        const check = validateFile(file);
        if (check.error) { setStatus(check.error, 'error'); return; }
        clearPreview();
        state.file = file;
        state.results = [];
        $('bd-results').hidden = true;
        $('bd-results').innerHTML = '';
        setStatus('', null);
        const media = $('bd-preview-media');
        if (media) {
            if (check.kind !== 'heic' && root.URL && typeof root.URL.createObjectURL === 'function') {
                state.previewUrl = root.URL.createObjectURL(file);
                const img = doc.createElement('img');
                img.src = state.previewUrl;
                img.alt = 'Foto que vas a buscar';
                media.appendChild(img);
            } else {
                media.innerHTML = '<span class="bd-preview-heic">HEIC</span>';
            }
        }
        $('bd-preview-name').textContent = String(file.name || 'Foto');
        $('bd-preview').hidden = false;
        $('bd-drop').hidden = true;
        const submit = $('bd-submit');
        if (submit) submit.focus();
    }

    function resetPicker() {
        clearPreview();
        state.file = null;
        $('bd-preview').hidden = true;
        $('bd-drop').hidden = false;
        const input = $('bd-file');
        if (input) { input.value = ''; input.focus(); }
    }

    async function runSearch() {
        if (state.busy || !state.file) return;
        setBusy(true);
        setStatus(MSG.preparing, 'info');
        let blob;
        try {
            blob = await prepare(state.file);
        } catch (err) {
            setBusy(false);
            setStatus((err && err.message) || MSG.generic, 'error');
            return;
        }
        setStatus(MSG.searching, 'info');
        const res = await search(blob);
        setBusy(false);
        if (res.json && res.json.limits) setLimit(res.json.limits.remaining);
        if (!res.ok) {
            if (res.status === 401) { setStatus('', null); showGate(); return; }
            setStatus(errorFor(res.status, res.json), 'error');
            return;
        }
        setStatus('', null);
        state.results = Array.isArray(res.json.results) ? res.json.results : [];
        const box = $('bd-results');
        box.innerHTML = resultsHtml(state.results, basePath());
        box.hidden = false;
        const title = $('bd-results-title');
        if (title) { try { title.focus({ preventScroll: false }); } catch (_) { title.focus(); } }
    }

    function openReport(btn) {
        const index = Number(btn.getAttribute('data-bd-index'));
        const result = state.results[index];
        const options = reportOptions(result, state.file, btn.getAttribute('data-bd-report'));
        if (!options || !root.WoReport || typeof root.WoReport.open !== 'function') {
            setStatus(MSG.reportUnavailable, 'error');
            return;
        }
        options.opener = btn;
        root.WoReport.open(options);
    }

    function wireLinks() {
        const base = basePath();
        if (!base) return;
        doc.querySelectorAll('a[data-bd-link]').forEach(function (a) {
            const href = a.getAttribute('href') || '';
            if (href.charAt(0) === '/' && href.indexOf(base + '/') !== 0) a.setAttribute('href', base + href);
        });
    }

    function wire() {
        const input = $('bd-file');
        const drop = $('bd-drop');
        input.addEventListener('change', function () {
            const file = input.files && input.files[0];
            if (file) pickFile(file);
        });
        ['dragenter', 'dragover'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('dragover'); });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('dragover'); });
        });
        drop.addEventListener('drop', function (e) {
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) pickFile(file);
        });
        $('bd-change').addEventListener('click', resetPicker);
        $('bd-form').addEventListener('submit', function (e) { e.preventDefault(); runSearch(); });
        $('bd-results').addEventListener('click', function (e) {
            const btn = e.target && e.target.closest ? e.target.closest('[data-bd-report]') : null;
            if (btn) openReport(btn);
        });
    }

    async function evaluateSession() {
        state.session = await getSession();
        if (state.session) showSearch(); else showGate();
    }

    async function watchAuth() {
        try {
            const client = await getClient();
            if (!client || !client.auth || typeof client.auth.onAuthStateChange !== 'function') return;
            client.auth.onAuthStateChange(function (event) {
                if (event === 'INITIAL_SESSION') return;
                evaluateSession();
            });
        } catch (_) { /* sin cliente: queda la invitación a entrar */ }
    }

    function boot() {
        const start = function () {
            wireLinks();
            wire();
            evaluateSession().then(watchAuth);
        };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
        else start();
        root.WeotziData = root.WeotziData || {};
        root.WeotziData.Designs = { search: search };
    }

    return { boot: boot, _internal: pure };
});
