'use strict';

// Front de la fase 2: página /buscar-diseno (public/buscar-diseno/index.html +
// public/shared/js/buscar-diseno.js) y las alertas de imagen duplicada en la
// pestaña Sanciones del panel de soporte (support-dashboard-sanctions.js).
// Los módulos corren en un navegador simulado (tests/helpers/mini-dom.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument, createEvent, Element } = require('./helpers/mini-dom');
const N = require('../public/shared/js/neutral-es.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const B = require('../public/shared/js/buscar-diseno.js')._internal;
const SNQ = require('../public/shared/js/support-dashboard-sanctions.js')._internal;

const ARTIST_USER = '22222222-2222-4222-8222-222222222222';
const STUDIO = '44444444-4444-4444-8444-444444444444';
const ALERT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ALERT_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SUPA = 'https://flbgmlvfiejfttlawnfu.supabase.co/storage/v1/object/public';

// mini-dom no trae insertAdjacent*: lo justo para el panel de soporte.
if (!Element.prototype.insertAdjacentElement) {
    Element.prototype.insertAdjacentElement = function (where, el) {
        if (where !== 'afterend' || !this.parentNode) throw new Error('insertAdjacentElement: solo afterend');
        const siblings = this.parentNode.childNodes;
        this.parentNode.insertBefore(el, siblings[siblings.indexOf(this) + 1] || null);
        return el;
    };
}
// …ni setter de id (el panel crea su <section id="snq-panel">).
if (!Object.getOwnPropertyDescriptor(Element.prototype, 'id').set) {
    Object.defineProperty(Element.prototype, 'id', {
        configurable: true,
        get() { return this.getAttribute('id') || ''; },
        set(value) { this.setAttribute('id', value); }
    });
}
if (!Element.prototype.insertAdjacentHTML) {
    Element.prototype.insertAdjacentHTML = function (where, html) {
        const holder = new Element('div', this.ownerDocument);
        holder.innerHTML = html;
        holder.childNodes.slice().forEach((n) => this.insertAdjacentElement('afterend', n));
    };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle(n = 12) { for (let i = 0; i < n; i++) await tick(); }

// Cadenas entre comillas de un archivo (para la revisión de tuteo).
function literals(src) {
    const out = [];
    const re = /'((?:[^'\\\n]|\\.)*)'/g;
    let m;
    while ((m = re.exec(src))) if (/[a-záéíóúñ]{3,}\s+[a-záéíóúñ]/i.test(m[1])) out.push(m[1]);
    return out;
}

const RESULTS = [
    { distance: 0, confidence: 'casi_segura', confidence_label: 'Casi segura', source_kind: 'artist_gallery', item_key: `artist-gallery/${ARTIST_USER}/1.jpg`, image_url: `${SUPA}/artist-gallery/${ARTIST_USER}/1.jpg`, first_seen_at: '2026-08-01T12:00:00Z', owner: { kind: 'artist', id: ARTIST_USER, name: 'Mateo Rivas', username: 'mateo.ink', profile_url: '/artist/profile?artist=mateo.ink' } },
    { distance: 10, confidence: 'parecida', confidence_label: 'Parecida', source_kind: 'store_design', item_key: 'store/x', image_url: `${SUPA}/store-previews/x.jpg`, first_seen_at: '2026-09-01T12:00:00Z', owner: { kind: 'studio', id: STUDIO, name: 'Estudio Norte', slug: 'estudio-norte', profile_url: '/studio/profile?studio=estudio-norte' } }
];

// ------------------------------------------------------------------ página

test('/buscar-diseno: DS, sesión de Supabase, HEIC, consentimiento y wo-report (con su CSS) antes del módulo', () => {
    const html = read('public/buscar-diseno/index.html');
    for (const asset of [
        '/shared/css/ds/tokens.css', '/shared/css/ds/components.css', '/shared/css/wo-report.css', '/shared/css/buscar-diseno.css?v=',
        '@supabase/supabase-js@2', '/shared/js/config-manager.js', '/shared/js/data/postgrest-client.js',
        'heic2any', '/shared/js/heic-converter.js', '/shared/js/wo-consent.js', '/shared/js/wo-report.js?v=', '/shared/js/buscar-diseno.js?v='
    ]) assert.ok(html.includes(asset), asset);
    assert.ok(html.indexOf('/shared/js/wo-report.js') < html.indexOf('/shared/js/buscar-diseno.js'), 'WoReport existe cuando se usa');
    assert.ok(html.indexOf('/shared/js/config-manager.js') < html.indexOf('/shared/js/buscar-diseno.js'));
    assert.match(html, /<html lang="es">/);
    assert.match(html, /class="wo-topbar/);
    assert.match(html, /<h1 class="bd-title" id="bd-titulo">¿Dónde está este diseño\?<\/h1>/);
    assert.ok(html.includes('Busca la misma foto o copias con cambios menores, dentro de We Ötzi. Todavía no encuentra diseños redibujados.'));
    assert.ok(html.includes('Que dos diseños se parezcan no prueba un plagio: soporte revisa cada caso.'));
    assert.ok(html.includes('Inicia sesión') && html.includes('Crea tu cuenta'));
    assert.match(html, /returnTo=%2Fbuscar-diseno/);
    // Accesible: input con etiqueta y ayuda, resultados anunciados, salto al contenido.
    assert.match(html, /<label class="wo-dropzone bd-drop" id="bd-drop" for="bd-file">/);
    assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,image\/heic/);
    assert.match(html, /aria-describedby="bd-file-help"/);
    assert.match(html, /id="bd-results"[^>]*aria-live="polite"/);
    assert.match(html, /id="bd-status" role="status" aria-live="polite"/);
    assert.match(html, /class="bd-skip" href="#contenido"/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
});

test('/buscar-diseno: CSS con tokens del DS, 375px en una columna y objetivos táctiles de 44px', () => {
    const css = read('public/shared/css/buscar-diseno.css');
    assert.match(css, /\.bd-grid \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(css, /@media \(min-width: 600px\)/);
    assert.match(css, /min-height: 44px/);
    assert.match(css, /overflow-wrap: anywhere/);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/, 'solo tokens, sin colores sueltos');
});

test('buscar-diseno.js: datos solo por el endpoint del servidor, sin rest/v1 ni consultas directas', () => {
    const src = read('public/shared/js/buscar-diseno.js');
    assert.doesNotMatch(src, /rest\/v1/);
    assert.doesNotMatch(src, /\.from\(/);
    assert.doesNotMatch(src, /storage\s*\.\s*from|\.upload\(/, 'la foto no se sube desde aquí');
    assert.match(src, /const ENDPOINT = '\/api\/disenos\/buscar';/);
    assert.match(src, /root\.WeotziData\.Designs = \{ search: search \}/);
    assert.match(src, /root\.WoReport\.open\(options\)/);
});

test('textos en español neutro con tuteo (sin voseo ni «seña»)', () => {
    const files = ['public/buscar-diseno/index.html', 'public/shared/js/buscar-diseno.js', 'lib/routes/disenos.js', 'services/email-events/disenos.js'];
    for (const file of files) {
        const src = read(file);
        assert.doesNotMatch(src, /\bseña\b/i, `${file}: «seña»`);
        const texts = file.endsWith('.html') ? src.replace(/<[^>]+>/g, '\n').split('\n').map((t) => t.trim()).filter(Boolean) : literals(src);
        for (const t of texts) assert.equal(N.neutralize(t), t, `${file}: ${t}`);
    }
    const snq = literals(read('public/shared/js/support-dashboard-sanctions.js'));
    for (const t of snq) assert.equal(N.neutralize(t), t, t);
});

// ------------------------------------------------------------------ helpers puros

test('archivo: JPG, PNG, WebP o HEIC de hasta 10 MB; reducción a 1600 px sin agrandar', () => {
    assert.equal(B.validateFile({ name: 'a.jpg', type: 'image/jpeg', size: 10 }).ok, true);
    assert.equal(B.validateFile({ name: 'IMG_1.HEIC', type: '', size: 10 }).kind, 'heic', 'HEIC sin tipo, por extensión');
    assert.equal(B.validateFile({ name: 'a.gif', type: 'image/gif', size: 10 }).error, B.MSG.fileType);
    assert.equal(B.validateFile({ name: 'a.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 }).error, B.MSG.fileSize);
    assert.equal(B.validateFile({ name: 'a.png', type: 'image/png', size: 0 }).error, B.MSG.fileEmpty);
    assert.deepEqual(B.scaleSize(4000, 3000, 1600), { width: 1600, height: 1200 });
    assert.deepEqual(B.scaleSize(900, 1200, 1600), { width: 900, height: 1200 });
    assert.equal(B.limitText(14), 'Te quedan 14 búsquedas hoy.');
    assert.equal(B.limitText(1), 'Te queda 1 búsqueda hoy.');
    assert.match(B.limitText(0), /No te quedan búsquedas/);
    assert.equal(B.fmtDate('2026-08-01T12:00:00Z'), '1 de agosto de 2026');
});

test('resultados: miniatura, dueño, «Subido a We Ötzi el …», confianza y dos botones; vacío honesto', () => {
    const html = B.resultsHtml(RESULTS, '/beta');
    assert.match(html, /Encontramos 2 coincidencias/);
    assert.match(html, /Subido a We Ötzi el 1 de agosto de 2026/);
    assert.match(html, /bd-conf--casi_segura">Casi segura/);
    assert.match(html, /bd-conf--parecida">Parecida/);
    assert.match(html, /href="\/beta\/artist\/profile\?artist=mateo\.ink"/);
    assert.equal((html.match(/data-bd-report="plagio"/g) || []).length, 2);
    assert.equal((html.match(/data-bd-report="suplantacion"/g) || []).length, 2);
    assert.match(html, />Denunciar plagio</);
    assert.match(html, />Es una suplantación</);
    assert.ok(html.includes('Que dos diseños se parezcan no prueba un plagio'));
    const evil = B.resultHtml({ ...RESULTS[0], image_url: 'javascript:alert(1)', owner: { ...RESULTS[0].owner, name: '<img src=x onerror=1>' } }, 0, '');
    assert.doesNotMatch(evil, /<img src=x|javascript:/);
    const empty = B.resultsHtml([], '');
    assert.match(empty, /No encontramos copias dentro de We Ötzi/);
});

test('reportOptions: artista o estudio, motivo, foto buscada, ítem del portafolio y contexto con la distancia', () => {
    const file = { name: 'mia.jpg', type: 'image/jpeg', size: 100 };
    const plagio = B.reportOptions(RESULTS[0], file, 'plagio');
    assert.deepEqual(plagio, {
        kind: 'artist', id: ARTIST_USER, label: 'Mateo Rivas', reason: 'plagio_diseno', context: 'buscador: distancia 0',
        item: { key: '1.jpg', image: `${SUPA}/artist-gallery/${ARTIST_USER}/1.jpg` }, file
    });
    // El servidor manda la clave y la URL como las guarda el perfil (lib/denuncias.js).
    const fromServer = B.reportOptions({ ...RESULTS[0], report_key: 'a,b.jpg', report_image_url: `${SUPA}/artist-gallery/${ARTIST_USER}/a,b.jpg`, image_url: `${SUPA}/artist-gallery/${ARTIST_USER}/a%2Cb.jpg` }, file, 'plagio');
    assert.deepEqual(fromServer.item, { key: 'a,b.jpg', image: `${SUPA}/artist-gallery/${ARTIST_USER}/a,b.jpg` });
    assert.equal(B.reportKey({ item_key: `artist:${ARTIST_USER}|id:fl_9` }), 'fl_9', 'flash: el id del ítem');
    assert.equal(B.reportOptions({ ...RESULTS[0], source_kind: 'store_preview' }, file, 'plagio').item, undefined, 'la vista previa de la Store tampoco');
    const supl = B.reportOptions(RESULTS[1], file, 'suplantacion');
    assert.equal(supl.kind, 'studio');
    assert.equal(supl.id, STUDIO);
    assert.equal(supl.reason, 'suplantacion_identidad');
    assert.equal(supl.item, undefined, 'una imagen de la Store no es un ítem del portafolio');
    assert.equal(supl.context, 'buscador: distancia 10');
    assert.equal(B.reportOptions(RESULTS[0], file, 'otro'), null);
    assert.equal(B.reportOptions({ owner: { kind: 'client', id: 'x' } }, file, 'plagio'), null);
});

// ------------------------------------------------------------------ página en un navegador simulado

function pageMain() {
    const html = read('public/buscar-diseno/index.html');
    return html.slice(html.indexOf('<main'), html.indexOf('</main>') + '</main>'.length);
}

function bootPage({ session = true, response } = {}) {
    const document = createDocument();
    document.body.innerHTML = pageMain();
    const fetches = [];
    const opened = [];
    const authHandlers = [];
    const client = {
        auth: {
            getSession: async () => ({ data: { session: session ? { user: { id: 'u1' }, access_token: 'tok-1' } : null } }),
            onAuthStateChange: (fn) => authHandlers.push(fn)
        }
    };
    class FakeImage { set src(v) { this._src = v; setImmediate(() => this.onerror && this.onerror()); } get src() { return this._src; } }
    class PageURL extends URL {}
    PageURL.createObjectURL = () => 'blob:preview';
    PageURL.revokeObjectURL = () => {};
    const win = {
        document,
        console,
        location: { pathname: '/beta/buscar-diseno', search: '', hash: '' },
        setTimeout, clearTimeout, setImmediate, Promise, URL: PageURL, Image: FakeImage,
        ConfigManager: { ready: async () => {}, getSupabaseClient: () => client },
        WoReport: { open: (opts) => { opened.push(opts); return Promise.resolve(true); } },
        fetch: async (url, init) => {
            fetches.push({ url, init });
            const r = response || { status: 200, json: { success: true, results: RESULTS, limits: { daily: 20, remaining: 14 } } };
            return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
        }
    };
    win.window = win;
    vm.runInNewContext(read('public/shared/js/buscar-diseno.js'), win);
    return { win, document, fetches, opened, authHandlers };
}

test('página sin sesión: invitación a entrar con returnTo y base /beta; no hay buscador', async () => {
    const { document, fetches } = bootPage({ session: false });
    await settle();
    assert.equal(document.getElementById('bd-gate').hidden, false);
    assert.equal(document.getElementById('bd-search').hidden, true);
    assert.equal(document.getElementById('bd-login').href, '/beta/client/login?returnTo=%2Fbuscar-diseno');
    assert.equal(document.getElementById('bd-register').href, '/beta/client/register?returnTo=%2Fbuscar-diseno');
    assert.equal(fetches.length, 0);
});

test('página con sesión: busca con Bearer, pinta resultados y el contador, y «Denunciar plagio» abre WoReport con la foto', async () => {
    const { document, fetches, opened } = bootPage();
    await settle();
    assert.equal(document.getElementById('bd-search').hidden, false);
    const file = { name: 'mi-diseno.jpg', type: 'image/jpeg', size: 2048 };
    const input = document.getElementById('bd-file');
    input.files = [file];
    input.dispatchEvent(createEvent('change', { bubbles: true }));
    assert.equal(document.getElementById('bd-preview').hidden, false);
    document.getElementById('bd-form').dispatchEvent(createEvent('submit', { bubbles: true }));
    await settle(30);

    assert.equal(fetches.length, 1);
    assert.equal(fetches[0].url, '/beta/api/disenos/buscar');
    assert.equal(fetches[0].init.method, 'POST');
    assert.equal(fetches[0].init.headers.Authorization, 'Bearer tok-1');
    assert.equal(fetches[0].init.headers['Content-Type'], 'image/jpeg');
    assert.equal(fetches[0].init.body, file, 'sin canvas, se manda el JPEG original');

    const results = document.getElementById('bd-results');
    assert.equal(results.hidden, false);
    assert.match(results.textContent, /Encontramos 2 coincidencias/);
    assert.equal(document.getElementById('bd-limit').textContent, 'Te quedan 14 búsquedas hoy.');

    results.querySelector('[data-bd-report="plagio"][data-bd-index="0"]').click();
    assert.equal(opened.length, 1);
    assert.equal(opened[0].file, file, 'la foto buscada viaja como evidencia');
    assert.equal(opened[0].reason, 'plagio_diseno');
    assert.equal(opened[0].kind, 'artist');
    assert.equal(opened[0].id, ARTIST_USER);
    assert.deepEqual(JSON.parse(JSON.stringify(opened[0].item)), { key: `1.jpg`, image: `${SUPA}/artist-gallery/${ARTIST_USER}/1.jpg` });
    assert.equal(opened[0].context, 'buscador: distancia 0');

    results.querySelector('[data-bd-report="suplantacion"][data-bd-index="1"]').click();
    assert.equal(opened[1].reason, 'suplantacion_identidad');
    assert.equal(opened[1].kind, 'studio');
    assert.equal(opened[1].file, file);
});

test('página: tope diario (429), buscador apagado (503) y tipo de archivo inválido', async () => {
    const limited = bootPage({ response: { status: 429, json: { success: false, error: 'Llegaste al límite de 20 búsquedas por día. Prueba de nuevo mañana.', limits: { remaining: 0 } } } });
    await settle();
    const input = limited.document.getElementById('bd-file');
    input.files = [{ name: 'a.png', type: 'image/png', size: 10 }];
    input.dispatchEvent(createEvent('change', { bubbles: true }));
    limited.document.getElementById('bd-form').dispatchEvent(createEvent('submit', { bubbles: true }));
    await settle(30);
    assert.match(limited.document.getElementById('bd-status').textContent, /Llegaste al límite de 20 búsquedas/);
    assert.match(limited.document.getElementById('bd-limit').textContent, /No te quedan búsquedas/);

    const off = bootPage({ response: { status: 503, json: { success: false, error: 'El buscador se habilita pronto.' } } });
    await settle();
    const offInput = off.document.getElementById('bd-file');
    offInput.files = [{ name: 'a.webp', type: 'image/webp', size: 10 }];
    offInput.dispatchEvent(createEvent('change', { bubbles: true }));
    off.document.getElementById('bd-form').dispatchEvent(createEvent('submit', { bubbles: true }));
    await settle(30);
    assert.equal(off.document.getElementById('bd-status').textContent, 'El buscador se habilita pronto.');

    const bad = bootPage();
    await settle();
    const badInput = bad.document.getElementById('bd-file');
    badInput.files = [{ name: 'a.gif', type: 'image/gif', size: 10 }];
    badInput.dispatchEvent(createEvent('change', { bubbles: true }));
    assert.equal(bad.document.getElementById('bd-status').textContent, B.MSG.fileType);
    assert.equal(bad.document.getElementById('bd-preview').hidden, true);
    assert.equal(bad.fetches.length, 0);
});

// ------------------------------------------------------------------ panel de soporte

const IMAGE_ALERT = {
    id: ALERT, kind: 'image_duplicate', kind_label: 'Posible copia de imagen', status: 'open', status_label: 'Abierta',
    subject_user_id: ARTIST_USER, related_user_id: '55555555-5555-4555-8555-555555555555', created_at: '2026-11-18T10:05:00Z',
    payload: {
        pair_key: 'p1', distance: 1, confidence: 'casi_segura',
        new: { source_kind: 'artist_gallery', item_key: 'artist-gallery/u/copy.jpg', image_url: `${SUPA}/artist-gallery/u/copy.jpg`, owner_kind: 'artist', owner_id: ARTIST_USER, first_seen_at: '2026-11-18T10:00:00Z' },
        existing: { source_kind: 'studio_feed', item_key: 'studio-photos/s/a.jpg', image_url: 'javascript:alert(1)', owner_kind: 'studio', owner_id: STUDIO, first_seen_at: '2026-09-01T10:00:00Z' }
    }
};
const OWNERS = {
    new: { kind: 'artist', id: ARTIST_USER, name: 'Mateo Rivas', username: 'mateo.ink', profile_url: '/artist/profile?artist=mateo.ink', sanction_state: 'none' },
    existing: { kind: 'studio', id: STUDIO, name: 'Estudio Norte', slug: 'estudio-norte', profile_url: '/studio/profile?studio=estudio-norte', sanction_state: 'none' }
};

test('soporte: la alerta de imagen pinta las dos fotos, dueños, fechas, distancia, confianza y tres acciones', () => {
    const html = SNQ.alertDetailHtml(IMAGE_ALERT, OWNERS, '/beta');
    assert.match(html, /data-snq-alert-kind="image_duplicate"/);
    assert.match(html, /Imagen nueva/);
    assert.match(html, /Imagen anterior/);
    assert.match(html, new RegExp(`<img src="${SUPA.replace(/[.]/g, '\\.')}/artist-gallery/u/copy\\.jpg"`));
    assert.doesNotMatch(html, /javascript:/, 'una URL no https no se pinta');
    assert.match(html, /Sin vista previa/);
    assert.match(html, /Mateo Rivas \(@mateo\.ink\)/);
    assert.match(html, /Estudio Norte \(estudio-norte\)/);
    assert.match(html, /href="\/beta\/artist\/profile\?artist=mateo\.ink"/);
    assert.match(html, /1 de 64/);
    assert.match(html, /snq-conf--casi_segura">Casi segura/);
    assert.match(html, /Vista por primera vez/);
    for (const a of ['legitimo', 'retirar', 'denuncia']) assert.match(html, new RegExp(`data-snq-image-action="${a}"`));
    assert.match(html, />LEGÍTIMO</);
    assert.match(html, />RETIRAR</);
    assert.match(html, />ABRIR DENUNCIA</);
    assert.match(html, /Nada se ocultó solo/);
    assert.equal(SNQ.alertSummary(IMAGE_ALERT), 'Distancia 1 · Casi segura · Galería del artista');
    const closed = SNQ.alertDetailHtml({ ...IMAGE_ALERT, status: 'handled', resolution: 'Retirada: copia.' }, OWNERS, '');
    assert.doesNotMatch(closed, /data-snq-image-form/);
    assert.match(closed, /Retirada: copia\./);
    // Las otras alertas siguen igual.
    // Store (vista previa o diseño): no se retira desde aquí; el botón queda deshabilitado.
    const storeAlert = { ...IMAGE_ALERT, payload: { ...IMAGE_ALERT.payload, new: { ...IMAGE_ALERT.payload.new, source_kind: 'store_preview' } } };
    const storeHtml = SNQ.alertDetailHtml(storeAlert, OWNERS, '');
    assert.doesNotMatch(storeHtml, /data-snq-image-action="retirar"/);
    assert.match(storeHtml, /disabled aria-describedby="snq-image-store-help">RETIRAR</);
    assert.match(storeHtml, /Vista previa de la Store/);
    assert.equal(SNQ.canRetire(IMAGE_ALERT.payload), true);
    assert.equal(SNQ.canRetire(storeAlert.payload), false);
    // Copia de lo retirado: soporte la ve para volver a publicarla.
    const removed = SNQ.alertDetailHtml({ ...IMAGE_ALERT, status: 'handled', resolution: 'Retirada: copia.', payload: { ...IMAGE_ALERT.payload, removal: { at: '2026-11-19T15:00:00Z', by: 'x', source: 'artists_db.gallery_feed_items', items: [{ url: `${SUPA}/artist-gallery/u/copy.jpg`, title: '<b>Golondrina</b>' }, { url: 'javascript:alert(1)' }] } } }, OWNERS, '');
    assert.match(removed, /Copia de lo retirado/);
    assert.match(removed, /&lt;b&gt;Golondrina&lt;\/b&gt;/);
    assert.doesNotMatch(removed, /href="javascript:/);
    const reentry = SNQ.alertDetailHtml({ id: ALERT_2, kind: 'reentry_blocked', status: 'open', payload: { match_kinds: ['email'] } });
    assert.match(reentry, /data-snq-alert-form/);
    assert.doesNotMatch(reentry, /data-snq-image-form/);
    const refund = SNQ.alertDetailHtml({ id: ALERT_2, kind: 'refund_needed', status: 'open', payload: { quotes: [{ quote_id: 'WO-1', amount: 10, currency: 'USD' }] } });
    assert.match(refund, /WO-1/);
    assert.match(refund, /data-snq-alert-form/);
});

test('soporte: buildImageAction exige nota para retirar', () => {
    assert.equal(SNQ.buildImageAction('retirar', ' ').field, 'note');
    assert.deepEqual(SNQ.buildImageAction('retirar', ' Copia exacta. '), { action: 'retirar', note: 'Copia exacta.' });
    assert.deepEqual(SNQ.buildImageAction('legitimo', ''), { action: 'legitimo', note: '' });
    assert.match(SNQ.buildImageAction('ocultar', '').error, /Elige qué hacer/);
});

test('repo de soporte: imageAlert e imageAlertAction por el endpoint de diseños', async () => {
    const calls = [];
    const sandbox = {
        console,
        location: { pathname: '/support/dashboard' },
        WeotziData: { getClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'u' }, access_token: 'tok' } } }) } }) },
        fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ success: true }) }; }
    };
    sandbox.window = sandbox;
    vm.runInNewContext(read('public/shared/js/data/support-sanctions-repo.js'), sandbox);
    const R = sandbox.WeotziData.SupportSanctions;
    await R.imageAlert(ALERT);
    await R.imageAlertAction(ALERT, 'retirar', 'Copia exacta.');
    assert.equal(calls[0].url, `/api/support/image-alerts/${ALERT}`);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[1].url, `/api/support/image-alerts/${ALERT}`);
    assert.equal(calls[1].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[1].init.body), { action: 'retirar', note: 'Copia exacta.' });
    assert.equal((await R.imageAlertAction('nope', 'legitimo', '')).status, 400);
    assert.equal(calls.length, 2);
    const src = read('public/shared/js/data/support-sanctions-repo.js');
    assert.doesNotMatch(src, /\.from\(|rest\/v1\//);
});

function bootSupport() {
    const document = createDocument();
    document.body.innerHTML = '<nav class="tab-navigation"><button class="tab-btn" data-tab="sanciones">SANCIONES</button></nav>'
        + '<div id="table-container"></div><input type="checkbox" id="drawer-toggle"><div id="drawer-content"></div>';
    const calls = [];
    let alerts = [JSON.parse(JSON.stringify(IMAGE_ALERT)), { ...JSON.parse(JSON.stringify(IMAGE_ALERT)), id: ALERT_2 }];
    const ok = (json) => ({ ok: true, status: 200, json: { success: true, ...json } });
    const repo = {
        hasSession: async () => true,
        list: async () => ok({ sanctions: [], counts: { proposed: 0, appealed: 0, open_alerts: 2 }, reviewer: { user_id: 'agent' } }),
        alerts: async () => ok({ alerts }),
        imageAlert: async (id) => { calls.push(['imageAlert', id]); return ok({ alert: alerts.find((a) => a.id === id), owners: OWNERS }); },
        imageAlertAction: async (id, action, note) => {
            calls.push(['imageAlertAction', id, action, note]);
            const a = alerts.find((x) => x.id === id);
            const updated = { ...a, status: action === 'legitimo' ? 'dismissed' : 'handled', resolution: `${action}: ${note}` };
            alerts = alerts.map((x) => (x.id === id ? updated : x));
            const extra = action === 'denuncia' ? { prefill: { user_id: ARTIST_USER, reason_code: 'plagio_diseno', summary: 'Posible copia de imagen (alerta de prueba).' } } : { removed: 1, email_sent: true };
            return ok({ action, alert: updated, ...extra });
        }
    };
    const win = {
        document, console, location: { pathname: '/support/dashboard', hash: '' },
        setTimeout: (fn, ms) => (ms > 1000 ? 0 : setTimeout(fn, ms)), setInterval: () => 0, clearInterval: () => {},
        addEventListener: () => {}, switchTab: () => {}, WeotziData: { SupportSanctions: repo }
    };
    win.window = win;
    vm.runInNewContext(read('public/shared/js/support-dashboard-sanctions.js'), win);
    return { win, document, calls };
}

async function openImageAlert(env, id) {
    env.win.switchTab('sanciones');
    await settle();
    env.document.querySelector('[data-snq-view="alerts"]').click();
    await settle();
    env.document.querySelector(`[data-snq-alert="${id}"]`).click();
    await settle();
}

test('soporte: «Retirar» manda la nota al endpoint y deja la alerta gestionada', async () => {
    const env = bootSupport();
    await openImageAlert(env, ALERT);
    const drawer = env.document.getElementById('drawer-content');
    assert.deepEqual(env.calls[0], ['imageAlert', ALERT], 'carga los dueños');
    assert.match(drawer.textContent, /Mateo Rivas \(@mateo\.ink\)/);

    // Sin nota, no sale a la red.
    drawer.querySelector('[data-snq-image-action="retirar"]').click();
    drawer.querySelector('[data-snq-image-form]').dispatchEvent(createEvent('submit', { bubbles: true }));
    await settle();
    assert.equal(env.calls.filter((c) => c[0] === 'imageAlertAction').length, 0);
    assert.match(env.document.getElementById('snq-image-feedback').textContent, /motivo del retiro/);

    env.document.getElementById('snq-image-note').value = 'Copia exacta de un trabajo anterior.';
    drawer.querySelector('[data-snq-image-action="retirar"]').click();
    drawer.querySelector('[data-snq-image-form]').dispatchEvent(createEvent('submit', { bubbles: true }));
    await settle();
    assert.deepEqual(env.calls.find((c) => c[0] === 'imageAlertAction'), ['imageAlertAction', ALERT, 'retirar', 'Copia exacta de un trabajo anterior.']);
    assert.match(drawer.textContent, /Foto retirada del portafolio/);
    assert.equal(drawer.querySelector('[data-snq-image-form]'), null, 'ya no se puede volver a actuar');
});

test('soporte: «Abrir denuncia» abre «Proponer sanción» precargado con plagio de diseños', async () => {
    const env = bootSupport();
    await openImageAlert(env, ALERT_2);
    const drawer = env.document.getElementById('drawer-content');
    drawer.querySelector('[data-snq-image-action="denuncia"]').click();
    drawer.querySelector('[data-snq-image-form]').dispatchEvent(createEvent('submit', { bubbles: true }));
    await settle();
    assert.deepEqual(env.calls.find((c) => c[0] === 'imageAlertAction'), ['imageAlertAction', ALERT_2, 'denuncia', '']);
    assert.ok(drawer.querySelector('[data-snq-propose-form]'), 'se abrió el formulario de propuesta');
    assert.equal(env.document.getElementById('snq-user').getAttribute('value'), ARTIST_USER);
    assert.ok(env.document.getElementById('snq-reason').querySelector('option[value="plagio_diseno"][selected]'));
    assert.match(env.document.getElementById('snq-summary').textContent, /Posible copia de imagen/);
});
