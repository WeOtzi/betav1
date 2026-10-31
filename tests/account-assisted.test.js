'use strict';
// Centro de la cuenta (/artist/account) · modo asistido (oct 2026).
// Cubre el modelo de contacto (WhatsApp / email), las anclas data-assist del
// contrato §6, el orden de scripts, la validación de Instagram del portafolio,
// la modalidad de trabajo y el evento wo:assist-refresh después de guardar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
// Los .js del repo vienen con CRLF y el HTML/CSS con LF: se normaliza a LF.
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const CM = require('../public/shared/js/account-contact-model.js');
const GV = require('../public/shared/js/gallery-visibility.js');

const html = read('public/artist/account/index.html');
const js = read('public/shared/js/artist-account.js');
const wallet = read('public/shared/js/wallet-account.js');
const css = read('public/shared/css/artist-account-ds.css');

// Cuerpo de una función declarada con 4 espacios de sangría dentro del IIFE.
function fnBody(src, signature) {
    const start = src.indexOf(signature);
    assert.ok(start > -1, 'existe ' + signature);
    const end = src.indexOf('\n    }\n', start);
    assert.ok(end > start, 'cierra ' + signature);
    return src.slice(start, end);
}

// Etiqueta de apertura del elemento con ese id.
function openTag(id) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > -1, `existe #${id}`);
    const start = html.lastIndexOf('<', at);
    return html.slice(start, html.indexOf('>', at) + 1);
}

function docTypes() {
    const match = js.match(/const DOC_TYPES = (\[[\s\S]*?\]);/);
    assert.ok(match, 'DOC_TYPES declarado');
    return new Function('return ' + match[1])();
}

/* ------------------------------ modelo de contacto ------------------------------ */

test('contacto: normalizeWhatsapp limpia separadores, conserva el + y exige formato internacional', () => {
    assert.deepEqual(CM.normalizeWhatsapp('+54 9 11 1234-5678'), { ok: true, value: '+5491112345678', empty: false, error: null });
    assert.equal(CM.normalizeWhatsapp('+54 (9) 11.1234.5678').value, '+5491112345678');
    assert.equal(CM.normalizeWhatsapp(' +34 600 123 456 ').value, '+34600123456', 'espacios no separables');
    assert.equal(CM.normalizeWhatsapp('+1 (415) 555-0100').value, '+14155550100');
    assert.deepEqual(CM.normalizeWhatsapp(''), { ok: true, value: null, empty: true, error: null });
    assert.deepEqual(CM.normalizeWhatsapp('   '), { ok: true, value: null, empty: true, error: null });
    assert.equal(CM.normalizeWhatsapp(null).ok, true);

    for (const bad of ['54 9 11 1234 5678', '+54 9 11', '+1234567', '+1234567890123456', '+54 9 11 1234 5678 ext', '++5491112345678', '+54/9/11/1234/5678']) {
        const result = CM.normalizeWhatsapp(bad);
        assert.equal(result.ok, false, bad);
        assert.equal(result.error, 'Usá el formato internacional, por ejemplo +54 9 11 1234 5678', bad);
    }
    assert.equal(CM.normalizeWhatsapp('+12345678').ok, true, '8 dígitos es el mínimo');
    assert.equal(CM.normalizeWhatsapp('+123456789012345').ok, true, '15 dígitos es el máximo');
    assert.equal(CM.MESSAGES.whatsappDuplicate, 'Ese WhatsApp ya está asociado a otra cuenta de We Ötzi.');
});

test('contacto: isValidEmail, sameEmail y maskEmail', () => {
    for (const ok of ['laura@weotzi.com', ' Laura.Tattoo@Gmail.com ', 'a@b.co', 'ana+ig@estudio.com.ar']) assert.equal(CM.isValidEmail(ok), true, ok);
    for (const bad of ['', '   ', 'laura', 'laura@', '@weotzi.com', 'laura@weotzi', 'la ura@weotzi.com', null, `${'a'.repeat(250)}@x.com`]) {
        assert.equal(CM.isValidEmail(bad), false, String(bad).slice(0, 20));
    }
    assert.equal(CM.normalizeEmail('  Laura@WeOtzi.COM '), 'laura@weotzi.com');
    assert.equal(CM.sameEmail('Laura@WeOtzi.com', 'laura@weotzi.com '), true);
    assert.equal(CM.sameEmail('laura@weotzi.com', 'lau@weotzi.com'), false);

    assert.equal(CM.maskEmail('laura.tattoo@gmail.com'), 'la···o@gmail.com');
    assert.equal(CM.maskEmail('Ana@x.com'), 'a···a@x.com');
    assert.equal(CM.maskEmail('jo@x.com'), 'j···@x.com');
    assert.equal(CM.maskEmail('j@x.com'), 'j···@x.com');
    assert.equal(CM.maskEmail('no-es-mail'), '');
    assert.doesNotMatch(CM.maskEmail('laura.tattoo@gmail.com'), /laura\.tattoo/);
});

test('contacto: isDuplicatePhoneError reconoce la unicidad de auth.users.phone', () => {
    assert.equal(CM.isDuplicatePhoneError({ code: '23505', message: 'duplicate key value violates unique constraint "users_phone_key"' }), true);
    assert.equal(CM.isDuplicatePhoneError({ message: 'Key (phone)=(5491112345678) already exists.' }), true);
    assert.equal(CM.isDuplicatePhoneError({ code: '23505', message: 'duplicate key value violates unique constraint "artists_db_username_key"' }), false);
    assert.equal(CM.isDuplicatePhoneError({ message: 'network error' }), false);
    assert.equal(CM.isDuplicatePhoneError(null), false);
});

/* ------------------------------ markup y anclas ------------------------------ */

const ANCHORS = [
    'perfil.banner', 'perfil.foto', 'perfil.redes', 'perfil.whatsapp', 'perfil.email', 'perfil.bio',
    'portafolio.trabajos', 'portafolio.instagram_validado', 'portafolio.portafolio_validado',
    'retiro.destino',
    'disponibilidad.modalidad', 'disponibilidad.estudio', 'disponibilidad.horarios',
    'notificaciones.preferencias',
    'verificacion.identidad', 'verificacion.domicilio', 'verificacion.bioseguridad', 'verificacion.solicitud',
    'configuracion.region', 'configuracion.moneda'
];

test('markup: cada ancla data-assist del contrato §6 existe (HTML o filas que pinta el JS)', () => {
    const tokens = new Set();
    for (const m of html.matchAll(/data-assist="([^"]+)"/g)) m[1].split(/\s+/).forEach((t) => tokens.add(t));
    assert.match(js, /data-assist="verificacion\.\$\{type\}"/, 'las filas de documentos llevan su ancla');
    docTypes().forEach(([type]) => tokens.add('verificacion.' + type));
    for (const anchor of ANCHORS) assert.ok(tokens.has(anchor), 'falta el ancla ' + anchor);

    // Cada sección relevante lleva el ancla de su paso.
    const sectionStep = { perfil: 'perfil', portafolio: 'portafolio', cobros: 'retiro', disponibilidad: 'disponibilidad',
        notificaciones: 'notificaciones', verificacion: 'verificacion', configuracion: 'configuracion' };
    for (const [section, step] of Object.entries(sectionStep)) {
        assert.match(openTag('aac-' + section), new RegExp(`data-assist="${step}"`), `#aac-${section} → ${step}`);
    }
});

test('markup: las anclas están en el elemento que corresponde', () => {
    assert.match(openTag('aac-banner-drop'), /data-assist="perfil\.banner"/);
    assert.match(openTag('aac-photo-drop'), /data-assist="perfil\.foto"/);
    assert.match(html, /Redes sociales<\/span>\s*<div class="aac-stack" data-assist="perfil\.redes">/);
    assert.match(html, /data-assist="perfil\.bio">\s*<label class="aac-label" for="aac-bio">/);
    assert.match(html, /data-assist="perfil\.whatsapp">\s*<label class="aac-label" for="aac-contact-whatsapp">/);
    assert.match(html, /data-assist="perfil\.email">\s*<label class="aac-label" for="aac-contact-email">/);
    assert.match(openTag('aac-works'), /data-assist="portafolio\.trabajos"/);
    assert.match(openTag('aac-ig-verify'), /data-assist="portafolio\.instagram_validado portafolio\.portafolio_validado"/);
    assert.match(html, /<div class="wal-dest" data-assist="retiro\.destino">[\s\S]*?Destinos de retiro/);
    assert.match(openTag('aac-modalidad'), /data-assist="disponibilidad\.modalidad"/);
    const studioField = openTag('aac-modalidad-studio-field');
    assert.match(studioField, /data-assist="disponibilidad\.estudio"/);
    assert.match(studioField, /\bhidden\b/, 'oculto hasta elegir estudio o ambos');
    assert.ok(html.indexOf('id="aac-modalidad-studio"') > html.indexOf('id="aac-modalidad-studio-field"'));
    assert.match(openTag('av-days'), /data-assist="disponibilidad\.horarios"/);
    assert.match(openTag('aac-notif-rows'), /data-assist="notificaciones\.preferencias"/);
    assert.match(openTag('aac-verif-alert'), /data-assist="verificacion\.solicitud"/);
    assert.match(html, /Región<\/span>\s*<div class="aac-grid2" data-assist="configuracion\.region">/);
    assert.match(html, /data-assist="configuracion\.moneda">\s*<label class="aac-label" for="aac-currency">/);
});

test('markup: bloque Contacto entre Redes sociales y GUARDAR CAMBIOS; WhatsApp fuera de Oficio', () => {
    const perfil = html.slice(html.indexOf('id="aac-perfil"'), html.indexOf('id="aac-portafolio"'));
    const order = ['id="aac-website"', '<span class="aac-eyebrow">Contacto</span>', 'id="aac-contact-whatsapp"',
        'id="aac-contact-email"', 'id="aac-profile-save"', '<details class="aac-more" id="aac-oficio">'];
    const at = order.map((needle) => perfil.indexOf(needle));
    assert.ok(at.every((p, i) => p > -1 && (i === 0 || p > at[i - 1])), 'orden en Mi perfil: ' + at.join(','));

    const whatsapp = openTag('aac-contact-whatsapp');
    for (const attr of ['type="tel"', 'inputmode="tel"', 'autocomplete="tel"', 'placeholder="+54 9 11 1234 5678"']) assert.ok(whatsapp.includes(attr), attr);
    const email = openTag('aac-contact-email');
    for (const attr of ['type="email"', 'autocomplete="email"', 'aria-describedby="aac-contact-email-help aac-contact-email-error"']) assert.ok(email.includes(attr), attr);
    assert.match(html, /id="aac-contact-email-help"/);
    assert.match(html, /id="aac-contact-whatsapp-error" role="alert" hidden/);

    const oficio = perfil.slice(perfil.indexOf('<details class="aac-more" id="aac-oficio">'));
    assert.doesNotMatch(oficio, /id="aac-whatsapp"|for="aac-whatsapp"/);
    assert.doesNotMatch(html, /id="aac-whatsapp"/);
    assert.doesNotMatch(fnBody(js, 'async function saveOficio()'), /whatsapp/i);
});

test('markup: Modalidad arriba de Ubicaciones, tarjeta de Instagram arriba de la grilla y reglas fijadas', () => {
    const dispo = html.slice(html.indexOf('id="aac-disponibilidad"'), html.indexOf('id="aac-notificaciones"'));
    assert.ok(dispo.indexOf('id="aac-modalidad"') > -1 && dispo.indexOf('id="aac-modalidad"') < dispo.indexOf('>Ubicaciones</span>'));
    assert.match(dispo, /role="radiogroup" aria-labelledby="aac-modalidad-title"/);
    for (const [value, label] of [['studio', 'Estudio'], ['independent', 'Independiente'], ['both', 'Ambos']]) {
        assert.match(dispo, new RegExp(`name="aac-modalidad" value="${value}"><span>${label}</span>`));
    }
    assert.match(dispo, /id="aac-modalidad-studio"[^>]*role="combobox"[^>]*aria-controls="aac-modalidad-studio-list"/);
    assert.match(dispo, /id="aac-modalidad-save">Guardar modalidad</);

    const porta = html.slice(html.indexOf('id="aac-portafolio"'), html.indexOf('id="aac-cobros"'));
    assert.ok(porta.indexOf('id="aac-ig-verify"') < porta.indexOf('id="aac-works"'));
    assert.ok(porta.indexOf('id="aac-works-summary"') < porta.indexOf('id="aac-works"'));

    // Restricciones de otros tests que este bloque no puede romper.
    assert.doesNotMatch(html, /integraciones|Integraciones/);
    assert.equal((html.match(/tabindex="-1" autofocus/g) || []).length, (html.match(/<dialog /g) || []).length);
    const copy = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/i, '');
    assert.doesNotMatch(copy, /[!¡]/, 'sin signos de exclamación');
});

test('scripts: gallery-visibility y account-contact-model entre config-manager y artist-account', () => {
    const pos = (file) => html.indexOf(`/shared/js/${file}`);
    const order = ['config-manager.js', 'data/account-repo.js', 'currency-utils.js', 'gallery-visibility.js',
        'account-contact-model.js', 'wallet-model.js', 'account-availability-model.js', 'wallet-account.js', 'artist-account.js'];
    const at = order.map(pos);
    assert.ok(at.every((p, i) => p > -1 && (i === 0 || p > at[i - 1])), 'orden: ' + at.join(','));
    assert.match(html, /currency-utils\.js"><\/script>\s*<script src="\/shared\/js\/gallery-visibility\.js[^"]*"><\/script>\s*<script src="\/shared\/js\/account-contact-model\.js/);
    assert.equal((html.match(/<script src="\/shared\/js\/gallery-visibility\.js/g) || []).length, 1);
    assert.equal((html.match(/<script src="\/shared\/js\/account-contact-model\.js/g) || []).length, 1);
});

/* ------------------------------ runtime ------------------------------ */

test('runtime: cada guardado exitoso dispara wo:assist-refresh con la sección', () => {
    assert.match(js, /document\.dispatchEvent\(new CustomEvent\('wo:assist-refresh', \{ detail: \{ section \} \}\)\)/);
    for (const section of ['perfil', 'portafolio', 'disponibilidad', 'notificaciones', 'verificacion', 'configuracion']) {
        assert.match(js, new RegExp(`assistRefresh\\('${section}'\\)`), section);
    }
    // Lugares concretos del pedido.
    assert.match(fnBody(js, 'async function saveProfile()'), /assistRefresh\('perfil'\)/);
    assert.match(fnBody(js, 'async function saveOficio()'), /assistRefresh\('perfil'\)/);
    assert.match(fnBody(js, 'async function persistWorks()'), /assistRefresh\('portafolio'\)/);
    assert.match(fnBody(js, 'function applyIgState(next)'), /assistRefresh\('portafolio'\)/);
    assert.match(fnBody(js, 'async function saveAvailability()'), /assistRefresh\('disponibilidad'\)/);
    assert.match(fnBody(js, 'async function saveModality()'), /assistRefresh\('disponibilidad'\)/);
    assert.match(fnBody(js, 'function renderNotifMatrix()'), /assistRefresh\('notificaciones'\)/);
    assert.equal((fnBody(js, 'function renderDocs()').match(/assistRefresh\('verificacion'\)/g) || []).length, 2, 'subir y eliminar documento');
    assert.match(fnBody(js, 'function renderVerification()'), /assistRefresh\('verificacion'\)/);
    assert.match(fnBody(js, 'async function setupSettings()'), /assistRefresh\('configuracion'\)/);
    const banner = js.slice(js.indexOf("wireDrop($('aac-banner-drop')"), js.indexOf("$('aac-profile-save').addEventListener"));
    assert.equal((banner.match(/assistRefresh\('perfil'\)/g) || []).length, 2, 'banner y foto');

    // Wallet: destino guardado, predeterminado y eliminado.
    assert.match(wallet, /new CustomEvent\('wo:assist-refresh', \{ detail: \{ section: 'cobros' \} \}\)/);
    assert.equal((fnBody(wallet, 'async function onDestinationSubmit(event)').match(/assistRefresh\(\)/g) || []).length, 1);
    assert.equal((fnBody(wallet, 'async function onDestinationListClick(event)').match(/assistRefresh\(\)/g) || []).length, 2);
});

test('runtime: validación de Instagram vía endpoint, WoDemo.api o fetch con Bearer y base path', () => {
    assert.match(js, /const IG_ENDPOINT = '\/api\/artist\/instagram-verification';/);
    const api = fnBody(js, 'async function igApi(path');
    assert.match(api, /window\.WoDemo\.api\(path/);
    assert.match(api, /Authorization = `Bearer \$\{token\}`/);
    assert.match(api, /fetch\(appPath\(path\)/);
    assert.match(fnBody(js, 'async function loadIgState()'), /igApi\(IG_ENDPOINT\)/);
    assert.match(fnBody(js, 'async function requestIgCode()'), /igApi\(IG_ENDPOINT, \{ method: 'POST', body: \{ handle \} \}\)/);
    assert.match(js, /const IG_POLL_MS = 20000;/);
    assert.match(fnBody(js, 'function scheduleIgPoll()'), /status !== 'pending'/);
    assert.match(fnBody(js, 'function igSectionVisible()'), /aac-portafolio/);

    // Demo: tarjeta simulada sin llamadas a la API.
    const load = fnBody(js, 'async function loadIgState()');
    assert.ok(load.indexOf('isDemo()') < load.indexOf('igApi('), 'el demo corta antes de llamar a la API');
    assert.match(js, /const IG_DEMO_CODE = 'WO-DEMO42';/);
    assert.match(js, /En modo demo la validación es simulada\./);

    const render = fnBody(js, 'function renderIgVerify()');
    assert.match(render, /La validación de Instagram se habilita pronto\. Mientras tanto tus fotos importadas se muestran como hasta ahora\./);
    assert.match(render, /no se muestran en tu perfil público hasta que valides/);
    assert.match(render, /Generar código/);
    assert.match(render, /Revisá tu correo <strong>\$\{esc\(ig\.email_masked\)\}<\/strong>/);
    assert.match(render, /seguí a <strong>@weotzi<\/strong>/);
    assert.match(render, /Mandá el código por mensaje directo a <strong>@weotzi<\/strong>/);
    assert.match(render, /target="_blank" rel="noopener">Abrir @weotzi →<\/a>/);
    assert.match(render, /Reenviar código/);
    assert.match(render, /emailSent \? '' : '<p class="aac-ig-warn"/);
    assert.match(render, /Instagram validado · @/);
    assert.match(render, /Tu portafolio está validado/);
    assert.match(render, /fotos de otra cuenta siguen pendientes/);
    assert.match(js, /const IG_FOLLOW_URL = 'https:\/\/www\.instagram\.com\/weotzi\/';/);

    // Badge y resumen en la grilla.
    assert.match(fnBody(js, 'function isPendingWork(item, state)'), /GV\.isPendingValidation\(item, state\)/);
    assert.match(fnBody(js, 'function igVisibilityState()'), /GV\.stateFrom\(\{ \.\.\.ig, enforced: ig\.available === true/);
    const works = fnBody(js, 'function renderWorks()');
    assert.match(works, /<span class="aac-work-badge">Pendiente de validación<\/span>/);
    assert.match(works, /aac-works-summary/);
});

test('runtime: el estado del endpoint decide qué fotos quedan pendientes (gallery-visibility)', () => {
    // Misma construcción que igVisibilityState() en artist-account.js.
    const stateOf = (ig) => GV.stateFrom({ ...ig, enforced: ig.available === true, handle: ig.verified_handle || ig.handle || null });
    const imported = { url: 'https://x.supabase.co/storage/v1/object/public/artist-gallery/instagram-import/u/abc.jpg', category: 'realizados', ig_handle: 'laura.tattoo' };
    const other = { url: 'https://x/instagram-import/u/def.jpg', source: 'instagram', ig_handle: 'otra.cuenta' };
    const legacy = { url: 'https://x/instagram-import/u/old.jpg', ig_legacy: true };
    const local = { url: 'https://x/artist-gallery/u/1.jpg', category: 'flash' };
    const items = [imported, other, legacy, local];

    assert.equal(GV.pendingCount(items, stateOf({ available: false, status: 'none' })), 0, 'sin backend todo se ve');
    assert.equal(GV.pendingCount(items, stateOf({ available: true, status: 'pending', handle: 'laura.tattoo' })), 2);
    const verified = stateOf({ available: true, status: 'verified', handle: 'laura.tattoo', verified_handle: 'laura.tattoo', verified_at: '2026-10-30T10:00:00Z' });
    assert.equal(GV.isPendingValidation(imported, verified), false);
    assert.equal(GV.isPendingValidation(other, verified), true, 'fotos de otra cuenta siguen pendientes');
    assert.equal(GV.isPendingValidation(legacy, verified), false);
    // Si el artista cambió el usuario en Mi perfil, manda el validado.
    const renamed = stateOf({ available: true, status: 'verified', handle: 'nuevo.usuario', verified_handle: 'laura.tattoo', verified_at: '2026-10-30T10:00:00Z' });
    assert.equal(GV.isPendingValidation(imported, renamed), false);
});

test('runtime: Mi perfil guarda el WhatsApp normalizado y el email por auth', () => {
    const save = fnBody(js, 'async function saveProfile()');
    assert.match(save, /CM\.normalizeWhatsapp\(\$\('aac-contact-whatsapp'\)\.value\)/);
    assert.ok(save.indexOf('whatsapp.ok') < save.indexOf('btn.disabled = true'), 'valida antes de guardar');
    assert.match(save, /saveWhatsapp\(whatsapp\.value\)/);
    const saveWa = fnBody(js, 'async function saveWhatsapp(value)');
    assert.match(saveWa, /updateArtist\(\{ whatsapp_number: value \}\)/);
    assert.match(saveWa, /CM\.isDuplicatePhoneError\(err\)/);
    assert.match(saveWa, /CM\.MESSAGES\.whatsappDuplicate/);
    assert.match(fnBody(js, 'function fillProfile()'), /\$\('aac-contact-whatsapp'\)\.value = extras\?\.whatsapp_number/);

    const email = fnBody(js, 'async function onEmailChange()');
    assert.ok(email.indexOf('isDemo()') > -1 && email.indexOf('isDemo()') < email.indexOf('_supabase.auth.updateUser({ email })'), 'el demo frena antes de auth');
    assert.match(email, /CM\.isValidEmail\(email\)/);
    assert.match(email, /Te enviamos un enlace a \$\{email\}\. El cambio se aplica cuando lo confirmes\./);
    assert.match(fnBody(js, 'function setupContact()'), /email\.value = user\.email/);
    const sync = fnBody(js, 'async function syncArtistEmail()');
    assert.match(sync, /isDemo\(\)/);
    assert.match(sync, /CM\.sameEmail\(user\.email, artist\.email\)/);
    assert.match(sync, /updateArtist\(\{ email: CM\.normalizeEmail\(user\.email\) \}\)/);
});

test('runtime: guardar la modalidad escribe work_type, estudios y studio_id y sincroniza el estudio base', () => {
    assert.match(js, /const INDEPENDENT_STUDIO = 'Sin estudio\/Independiente';/);
    assert.match(js, /const PRIVATE_STUDIO_NAME = 'ESTUDIO PRIVADO';/);
    assert.match(js, /const WORK_TYPES = \['studio', 'independent', 'both'\];/);

    const save = fnBody(js, 'async function saveModality()');
    assert.match(save, /work_type: type,/);
    assert.match(save, /estudios: withStudio \? nameUpper : INDEPENDENT_STUDIO,/);
    assert.match(save, /studio_id: studioId/);
    assert.match(save, /await updateArtist\(patch\)/);
    assert.match(save, /findOrCreateStudio\(name\)/);
    assert.match(save, /syncBaseLocation\(type, studioId, nameUpper\)/);
    assert.match(save, /await loadLocations\(\)/);

    const find = fnBody(js, 'async function findOrCreateStudio(name)');
    assert.match(find, /D\.Studios\.findIdByNormalizedName\(normalized\)/);
    assert.match(find, /D\.Studios\.createMinimal\(\{ name: name\.trim\(\), normalizedName: normalized \}\)/);
    assert.match(find, /createErr\.code === '23505'/);
    assert.match(find, /findIdByNormalizedName\(normalized, \{ single: true \}\)/);

    const base = fnBody(js, 'async function syncBaseLocation(type, studioId, nameUpper)');
    assert.match(base, /l\.period_type === 'current' && Number\(l\.sort_order\) === 0/);
    assert.match(base, /period_type: 'current', sort_order: 0,\s*studio_id: studioId, studio_name: nameUpper/);
    assert.match(base, /agenda_status: base\?\.agenda_status \|\| 'open'/);
    assert.match(base, /else if \(base && base\.studio_id\)/);
    assert.match(base, /studio_id: null, studio_name: PRIVATE_STUDIO_NAME/);
    assert.match(base, /D\.ArtistLocations\.upsertCurrentLocation\(row\)/);

    assert.match(fnBody(js, 'async function searchStudios(query)'),
        /D\.Studios\.searchByNormalizedName\(query\.toUpperCase\(\), \{\s*limit: 8, columns: 'id, name, normalized_name, city, country'\s*\}\)/);
    assert.match(fnBody(js, 'function renderStudioList(query, rows)'), /Agregar «\$\{esc\(r\.name\)\}»/);
});

test('runtime: AccountProfile.getExtras trae la modalidad y el estudio', async () => {
    const selects = [];
    const data = {
        run: async (label, build) => {
            const chain = { select(cols) { selects.push(cols); return chain; }, eq() { return chain; }, maybeSingle() { return chain; } };
            build({ from: () => chain });
            return { data: { work_type: 'both', estudios: 'TINTA ROJA', studio_id: 's-1' } };
        }
    };
    vm.runInNewContext(read('public/shared/js/data/account-repo.js'), { window: { WeotziData: data }, console }, { filename: 'account-repo.js' });
    const extras = await data.AccountProfile.getExtras('artist-1');
    assert.equal(extras.estudios, 'TINTA ROJA');
    const columns = selects[0].split(',').map((c) => c.trim());
    for (const col of ['whatsapp_number', 'work_type', 'estudios', 'studio_id', 'subscribed_newsletter']) assert.ok(columns.includes(col), col);
});

test('verificación: identidad y domicilio obligatorios, bioseguridad opcional; isVerified intacto', () => {
    const types = docTypes();
    assert.deepEqual(types.map(([type, , required]) => [type, required]), [['identidad', true], ['bioseguridad', false], ['domicilio', true]]);
    const docs = fnBody(js, 'function renderDocs()');
    assert.match(docs, /required \? 'Obligatorio' : 'Opcional'/);
    assert.match(fnBody(js, 'function isVerified()'), /return artist\?\.verification_state === 'Yes' \|\| docStatus\(identityDoc\(\)\) === 'verified';/);
    const verif = fnBody(js, 'function renderVerification()');
    assert.match(verif, /documento de identidad y un comprobante de domicilio \(obligatorios\)/);
    assert.match(verif, /bioseguridad es opcional/);
    assert.match(fnBody(js, 'function missingRequiredDocs()'), /status === 'missing' \|\| status === 'rejected'/);
});

test('datos y DS: sin _supabase.from ni rest/v1 nuevos, CSS con tokens y min-width', () => {
    const contact = read('public/shared/js/account-contact-model.js');
    for (const [name, src] of [['artist-account.js', js], ['wallet-account.js', wallet], ['account-contact-model.js', contact]]) {
        assert.doesNotMatch(src, /_supabase\.from\(/, name);
        assert.doesNotMatch(src, /rest\/v1/, name);
    }
    assert.doesNotMatch(contact, /document\.|window\.fetch|fetch\(/, 'el modelo es puro');
    assert.doesNotMatch(js, /¡/);
    assert.doesNotMatch(js, /[A-Za-zÁ-úñ.)]!['"`<]/, 'sin copy terminado en signo de exclamación');

    const block = css.slice(css.indexOf('Modo asistido (oct 2026)'));
    assert.ok(block.length > 200, 'bloque CSS del modo asistido');
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, 'sin hex');
    assert.doesNotMatch(block, /border-radius|box-shadow:(?!var\(--shadow-focus\))/, 'radius 0 y sin sombras en reposo');
    assert.doesNotMatch(css, /@media\s*\(max-width/);
    for (const sel of ['.aac-ig{', '.aac-work-badge{', '.av-mode-option span{', '.aac-typeahead-option{', '.aac-doc-req{', '.aac-help{']) {
        assert.ok(block.includes(sel), sel);
    }
    assert.match(block, /\.aac-typeahead-option\{[^}]*min-height:var\(--control-h-md\)/, 'opciones de 44px');
    assert.match(block, /\.av-mode-option span\{[^}]*min-height:var\(--control-h-md\)/, 'radios de 44px');
    for (const sel of ['.aac-works-summary[hidden]', '.aac-typeahead-list[hidden]', '.av-mode-studio[hidden]']) {
        assert.ok(block.includes(sel + '{display:none}'), sel);
    }
});

/* ------------------------------ correcciones de la revisión ------------------------------ */
// Corren las funciones reales de artist-account.js (extraídas del IIFE) con
// stubs para el DOM y los repos. Las variables de módulo que leen o reasignan
// llegan como parámetros compartidos por todas las funciones de la llamada.

const AV = require('../public/shared/js/account-availability-model.js');
const { computeSteps } = require('../services/artist-onboarding.js')._internal;
const quiet = { log() {}, warn() {}, error() {} };

function loadFns(signatures, scope, names) {
    const src = signatures.map((sig) => fnBody(js, sig) + '\n    }').join('\n');
    const keys = Object.keys(scope);
    return new Function(...keys, `'use strict';\n${src}\nreturn { ${names.join(', ')} };`)(...keys.map((k) => scope[k]));
}

// Función flecha declarada con 8 espacios dentro de otra función del IIFE.
function arrowSource(signature) {
    const start = js.indexOf(signature);
    assert.ok(start > -1, 'existe ' + signature);
    const end = js.indexOf('\n        };\n', start);
    assert.ok(end > start, 'cierra ' + signature);
    return js.slice(start, end) + '\n        };';
}

function fakeEl(value = '') {
    const attrs = {};
    return {
        value, hidden: false, disabled: false, focused: false, textContent: '', innerHTML: '', className: '',
        focus() { this.focused = true; },
        setAttribute(k, v) { attrs[k] = String(v); },
        removeAttribute(k) { delete attrs[k]; },
        getAttribute(k) { return k in attrs ? attrs[k] : null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        classList: { toggle() {}, add() {}, remove() {} }
    };
}

function fakeDom(values = {}) {
    const els = {};
    return { els, $: (id) => (els[id] ||= fakeEl(values[id] ?? '')) };
}

const stepOf = (result, id) => result.steps.find((s) => s.id === id);
const checkOf = (step, id) => step.checks.find((c) => c.id === id);

test('revisión #26: el vencimiento del código va en 24 h, sin "a m.."', () => {
    assert.match(fnBody(js, 'function formatDateTime(value)'), /hourCycle: 'h23'/);
    const { formatDateTime } = loadFns(['function formatDateTime(value)'], {}, ['formatDateTime']);
    for (const iso of ['2026-11-02T03:57:00Z', '2026-11-02T15:05:00Z', '2026-09-30T12:00:00Z']) {
        const text = formatDateTime(iso);
        assert.match(text, /^\d{1,2} \p{L}+, \d{2}:\d{2}$/u, text);
        assert.doesNotMatch(text, /\.|\b[ap]\s?m\b/, text);
    }
    assert.equal(formatDateTime('no-es-fecha'), '');
});

function renderIgCard(data, { handle = 'laura.tattoo', pending = 0, lastRequest = null } = {}) {
    const box = fakeEl();
    const { renderIgVerify } = loadFns(
        ['function esc(value)', 'function formatDateTime(value)', 'function renderIgVerify()'],
        {
            $: (id) => (id === 'aac-ig-verify' ? box : null), igState: { data, busy: false, lastRequest },
            GV, IG_DEMO_CODE: 'WO-DEMO42', igHandle: () => handle, pendingWorksCount: () => pending,
            igFollowUrl: () => 'https://www.instagram.com/weotzi/'
        },
        ['renderIgVerify']
    );
    renderIgVerify();
    return box;
}

test('revisión #27: la tarjeta pendiente no dice que mandamos el correo cuando no salió', () => {
    const expires = '2026-11-02T03:57:00Z';
    const pending = { available: true, status: 'pending', handle: 'laura.tattoo', expires_at: expires, email_masked: 'la***@weotzi.test' };

    const failed = renderIgCard({ ...pending, email_sent: false }).innerHTML;
    assert.doesNotMatch(failed, /te mandamos un código/);
    assert.match(failed, /<li>Tocá “Reenviar código” y revisá tu correo <strong>la\*\*\*@weotzi\.test<\/strong>: el código empieza con WO-\.<\/li>/);
    assert.match(failed, /role="alert">No pudimos enviarte el correo con el código/);

    // El GET no trae email_sent: manda lo que dijo el último POST para ese código.
    const viaPost = renderIgCard(pending, { lastRequest: { expires_at: expires, email_sent: false } }).innerHTML;
    assert.doesNotMatch(viaPost, /te mandamos un código/);
    assert.match(viaPost, /No pudimos enviarte el correo/);

    const sent = renderIgCard({ ...pending, email_sent: true }).innerHTML;
    assert.match(sent, /Revisá tu correo <strong>la\*\*\*@weotzi\.test<\/strong>: te mandamos un código que empieza con WO-\./);
    assert.doesNotMatch(sent, /No pudimos enviarte|Tocá “Reenviar código” y revisá/);
    assert.match(sent, /El código vence el \d{1,2} \p{L}+, \d{2}:\d{2}\.<\/p>/u, 'vencimiento en 24 h (#26)');

    const noMask = renderIgCard({ ...pending, email_masked: null, email_sent: false }).innerHTML;
    assert.match(noMask, /<li>Tocá “Reenviar código” y revisá tu correo: el código empieza con WO-\.<\/li>/);
    for (const card of [failed, sent, noMask]) assert.doesNotMatch(card, /[!¡]|a m\./);
});

test('revisión split #6: después de cambiar el usuario la tarjeta muestra la cuenta validada y ofrece validar la nueva', () => {
    const verifiedOld = { available: true, handle: 'laura.tattoo', verified: true, verified_handle: 'laura.old', verified_at: '2026-10-29T12:00:00Z' };

    const none = renderIgCard({ ...verifiedOld, status: 'none' }, { pending: 1 });
    assert.match(none.className, /aac-ig--ok/);
    assert.match(none.innerHTML, /<span class="aac-chip-ok">Validado<\/span>/);
    assert.match(none.innerHTML, /<h2 class="aac-ig-title">Instagram validado · @laura\.old<\/h2>/);
    assert.match(none.innerHTML, /1 foto de otra cuenta sigue pendiente: solo se publican las de @laura\.old\./);
    assert.match(none.innerHTML, /tu Instagram ahora es <strong>@laura\.tattoo<\/strong> y todavía no está validado\. Validalo para publicar lo que importes desde esa cuenta\./);
    assert.match(none.innerHTML, /data-ig-action="request"\s*>Validar esta cuenta<\/button>/);
    assert.doesNotMatch(none.innerHTML, /Sin validar/);

    const expired = renderIgCard({ ...verifiedOld, status: 'expired', expires_at: '2026-10-28T12:00:00Z' });
    assert.match(expired.className, /aac-ig--ok/);
    assert.match(expired.innerHTML, /Instagram validado · @laura\.old/);
    assert.match(expired.innerHTML, /El código que pediste venció: generá uno nuevo para publicar lo que importes desde esa cuenta\./);

    // Con un código pendiente para la cuenta nueva sigue la tarjeta de pendiente.
    const pending = renderIgCard({ ...verifiedOld, status: 'pending', expires_at: '2026-11-02T03:57:00Z', email_sent: true });
    assert.match(pending.className, /aac-ig--pending/);
    assert.match(pending.innerHTML, /<h2 class="aac-ig-title">Validá @laura\.tattoo<\/h2>/);

    // Sin una validación previa sigue siendo "Sin validar".
    const never = renderIgCard({ available: true, status: 'none', handle: 'laura.tattoo', verified: false, verified_handle: null, verified_at: null });
    assert.match(never.innerHTML, /Sin validar/);
    assert.doesNotMatch(never.className, /aac-ig--ok/);
    for (const card of [none, expired]) assert.doesNotMatch(card.innerHTML, /[!¡]/);
});

function profileHarness(stored, typed = stored) {
    const dom = fakeDom({ 'aac-username': 'laura', 'aac-bio': 'Bio nueva', 'aac-contact-whatsapp': typed || '' });
    const h = { dom, patches: [], toasts: [], refreshed: [] };
    Object.assign(h, loadFns(
        ['function setFieldError(inputId, message)', 'function normalizeHandle(value)',
            'async function saveProfile()', 'async function saveWhatsapp(value)'],
        {
            $: dom.$, CM, extras: { whatsapp_number: stored }, artist: { username: 'laura' }, user: { id: 'artist-1' },
            D: { Artists: { isUsernameAvailable: async () => ({ data: [] }) } },
            updateArtist: async (patch) => { h.patches.push(patch); },
            langsPicker: { get: () => [] }, profilePrefs: () => ({}), savePrefs: async () => {},
            setCountrySelect: () => {}, renderIgVerify: () => {}, console: quiet,
            toast: (msg, ok = true) => h.toasts.push([msg, ok]),
            assistRefresh: (section) => h.refreshed.push(section)
        },
        ['saveProfile']
    ));
    return h;
}

test('revisión split #5: un WhatsApp viejo sin tocar no frena el guardado de Mi perfil', async () => {
    const legacy = profileHarness('11 5555-1234');
    await legacy.saveProfile();
    assert.equal(legacy.patches.length, 1, 'solo el UPDATE del perfil');
    assert.equal(legacy.patches[0].bio_description, 'Bio nueva');
    assert.ok(!('whatsapp_number' in legacy.patches[0]));
    assert.deepEqual(legacy.toasts, [['Cambios guardados', true]]);
    assert.deepEqual(legacy.refreshed, ['perfil']);
    assert.equal(legacy.dom.$('aac-contact-whatsapp-error').hidden, true);
    assert.equal(legacy.dom.$('aac-contact-whatsapp').value, '11 5555-1234', 'el número queda como estaba');

    // Si lo edita, se valida igual que siempre y no se guarda nada.
    const edited = profileHarness('11 5555-1234', '11 5555-9999');
    await edited.saveProfile();
    assert.equal(edited.patches.length, 0);
    assert.equal(edited.dom.$('aac-contact-whatsapp-error').textContent, 'Usá el formato internacional, por ejemplo +54 9 11 1234 5678');
    assert.equal(edited.dom.$('aac-contact-whatsapp').focused, true);

    const fixed = profileHarness('11 5555-1234', '+54 9 11 5555 1234');
    await fixed.saveProfile();
    assert.deepEqual(fixed.patches.map((p) => p.whatsapp_number).filter(Boolean), ['+5491155551234']);

    const empty = profileHarness(null, '');
    await empty.saveProfile();
    assert.equal(empty.patches.length, 1, 'vacío y sin guardar: no se escribe el WhatsApp');
    assert.deepEqual(empty.toasts, [['Cambios guardados', true]]);
});

function availabilityHarness({ rows = [], appSettings = {} } = {}) {
    const dom = fakeDom();
    const h = { dom, rows, prefs: { app_settings: appSettings }, saved: [], refreshed: [], banner: undefined };
    h.avState = { locations: [], activeId: null, editing: false, drafts: {}, virtual: false };
    Object.assign(h, loadFns(
        ['function availabilitySettings()', 'function baseLocation()', 'function activeLocation()', 'function isBase(loc)',
            'function scheduleOf(loc)', 'async function loadLocations()', 'function carryAvailabilityDrafts()',
            'function onDayChange(event)', 'function enterAvailabilityEdit()', 'function seedVisibleSchedule()',
            'async function saveAvailability()'],
        {
            $: dom.$, AV, avState: h.avState, VIRTUAL_BASE_ID: 'base',
            artist: { city: 'Buenos Aires', country: 'Argentina' }, user: { id: 'artist-1' },
            D: { AvailabilityLocations: { list: async () => h.rows.map((r) => ({ ...r })), setAgendaStatus: async () => {} } },
            appSettings: () => h.prefs.app_settings,
            savePrefs: async (section, patch) => {
                h.saved.push([section, patch]);
                h.prefs.app_settings = { ...h.prefs.app_settings, ...patch };
            },
            renderAvailability: () => {}, toast: () => {}, console: quiet,
            showAvailabilitySaved: (loc, count) => { h.banner = loc ? loc.id : count; },
            assistRefresh: (section) => h.refreshed.push(section)
        },
        ['loadLocations', 'onDayChange', 'enterAvailabilityEdit', 'saveAvailability']
    ));
    return h;
}

const BASE_ROW = { id: 'real-loc-1', period_type: 'current', sort_order: 0, studio_name: 'TINTA ROJA', city: 'Buenos Aires', agenda_status: 'open' };
const TRAVEL_ROW = { id: 'travel-1', period_type: 'upcoming', sort_order: 1, studio_name: 'GUEST', city: 'Madrid', country: 'España',
    start_date: '2027-01-10', end_date: '2027-01-20', agenda_status: 'open' };
const enabledDays = (weekly) => weekly.filter((d) => d.enabled).map((d) => d.day);

test('revisión #5: guardar la modalidad a mitad de la edición conserva los días y Guardar cambios funciona', async () => {
    assert.match(js, /const VIRTUAL_BASE_ID = 'base';/);
    assert.match(fnBody(js, 'async function saveModality()'), /await loadLocations\(\);/);
    assert.match(fnBody(js, 'async function loadLocations()'), /carryAvailabilityDrafts\(\);\n\s*if \(!avState\.locations\.some/);

    const h = availabilityHarness();
    await h.loadLocations();
    assert.equal(h.avState.virtual, true);
    assert.equal(h.avState.activeId, 'base');
    h.enterAvailabilityEdit();
    h.onDayChange({ target: { dataset: { avDay: '5' }, checked: true } }); // sábado
    assert.equal(h.avState.drafts.base.weekly[5].enabled, true);

    // saveModality crea el estudio base (fila real) y recarga las ubicaciones.
    h.rows = [BASE_ROW];
    await h.loadLocations();
    assert.equal(h.avState.virtual, false);
    assert.equal(h.avState.activeId, 'real-loc-1', 'sigue en la base, ahora con fila');
    assert.deepEqual(Object.keys(h.avState.drafts), ['real-loc-1']);
    assert.equal(h.avState.drafts['real-loc-1'].weekly[5].enabled, true, 'el sábado tildado sigue tildado');
    assert.equal(h.avState.editing, true);

    await h.saveAvailability();
    assert.equal(h.dom.$('av-error').hidden, true, h.dom.$('av-error').textContent);
    assert.equal(h.saved.length, 1);
    const { availability } = h.saved[0][1];
    assert.deepEqual(enabledDays(availability.locations['real-loc-1'].weekly), ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']);
    assert.deepEqual(enabledDays(availability.weekly), enabledDays(availability.locations['real-loc-1'].weekly), 'la base se espeja en availability.weekly');
    assert.equal(availability.locations.base, undefined);
    assert.equal(h.avState.editing, false);
    assert.equal(h.banner, 'real-loc-1');
    assert.deepEqual(h.refreshed, ['disponibilidad']);
});

test('revisión #5: un borrador de una ubicación que ya no está se descarta sin romper el guardado', async () => {
    const h = availabilityHarness({ rows: [BASE_ROW, TRAVEL_ROW], appSettings: { availability: { weekly: AV.defaultWeekly() } } });
    await h.loadLocations();
    h.enterAvailabilityEdit();
    h.avState.activeId = 'travel-1';
    h.onDayChange({ target: { dataset: { avDay: '6' }, checked: true } });
    assert.ok(h.avState.drafts['travel-1']);

    h.rows = [BASE_ROW]; // el destino se borró en otra pestaña
    await h.loadLocations();
    assert.deepEqual(Object.keys(h.avState.drafts), []);
    assert.equal(h.avState.activeId, 'real-loc-1');
    await h.saveAvailability();
    assert.equal(h.dom.$('av-error').hidden, true, h.dom.$('av-error').textContent);
    assert.equal(h.saved.length, 0, 'la base ya tenía horario: nada que escribir');

    // Base virtual + un destino nuevo (sin estudio base): el borrador de la base
    // no tiene a dónde ir y se descarta en lugar de romper availabilityPatch.
    const travelOnly = availabilityHarness();
    await travelOnly.loadLocations();
    travelOnly.enterAvailabilityEdit();
    travelOnly.onDayChange({ target: { dataset: { avDay: '5' }, checked: true } });
    travelOnly.rows = [TRAVEL_ROW];
    await travelOnly.loadLocations();
    assert.equal(travelOnly.avState.drafts.base, undefined);
    await travelOnly.saveAvailability();
    assert.equal(travelOnly.dom.$('av-error').hidden, true, travelOnly.dom.$('av-error').textContent);

    // saveAvailability tampoco arma un patch para un borrador huérfano que no
    // pasó por loadLocations.
    const stray = availabilityHarness({ rows: [BASE_ROW], appSettings: { availability: { weekly: AV.defaultWeekly() } } });
    await stray.loadLocations();
    stray.enterAvailabilityEdit();
    stray.avState.drafts['ya-no-existe'] = { weekly: AV.defaultWeekly() };
    await stray.saveAvailability();
    assert.equal(stray.dom.$('av-error').hidden, true, stray.dom.$('av-error').textContent);
    assert.equal(stray.saved.length, 0);
});

test('revisión #16: Guardar cambios guarda el horario por defecto que se ve (lunes a viernes)', async () => {
    const h = availabilityHarness();
    await h.loadLocations();
    h.enterAvailabilityEdit();
    await h.saveAvailability();
    assert.equal(h.saved.length, 1, 'se guarda aunque no se haya tocado nada');
    const { availability } = h.saved[0][1];
    assert.deepEqual(availability.weekly, AV.defaultWeekly());
    assert.deepEqual(enabledDays(availability.weekly), ['lunes', 'martes', 'miercoles', 'jueves', 'viernes']);
    assert.equal(h.banner, 'base');
    assert.deepEqual(h.refreshed, ['disponibilidad']);
    // El paso Disponibilidad del servidor cuenta los horarios guardados.
    const dispo = stepOf(computeSteps({ artist: { work_type: 'independent' }, prefs: { app_settings: h.prefs.app_settings } }), 'disponibilidad');
    assert.equal(checkOf(dispo, 'horarios').done, true);

    // Una ubicación con fila y sin horario propio ni histórico también.
    const real = availabilityHarness({ rows: [BASE_ROW] });
    await real.loadLocations();
    real.enterAvailabilityEdit();
    await real.saveAvailability();
    assert.deepEqual(real.saved[0][1].availability.locations['real-loc-1'].weekly, AV.defaultWeekly());

    // Con horario guardado, guardar sin cambios no escribe nada.
    const saturdays = AV.defaultWeekly().map((d) => ({ ...d, enabled: d.day === 'sabado' }));
    const stored = availabilityHarness({ appSettings: { availability: { weekly: saturdays } } });
    await stored.loadLocations();
    stored.enterAvailabilityEdit();
    await stored.saveAvailability();
    assert.equal(stored.saved.length, 0);

    // Lo editado manda sobre el horario por defecto.
    const edited = availabilityHarness();
    await edited.loadLocations();
    edited.enterAvailabilityEdit();
    edited.onDayChange({ target: { dataset: { avDay: '0' }, checked: false } }); // lunes
    await edited.saveAvailability();
    assert.deepEqual(enabledDays(edited.saved[0][1].availability.weekly), ['martes', 'miercoles', 'jueves', 'viernes']);
});

function regionHarness({ artist, currency = 'ARS', timezone = 'America/Argentina/Buenos_Aires', failCurrency = false }) {
    const dom = fakeDom({ 'aac-setting-country': 'Argentina', 'aac-setting-city': 'Córdoba' });
    const h = { dom, artist, calls: [], appSettings: {} };
    const scope = {
        $: dom.$, artist, console: quiet, currencySel: fakeEl(currency), tzSel: fakeEl(timezone),
        toast: (msg, ok = true) => h.calls.push(['toast', msg, ok]),
        updateArtist: async (patch) => {
            h.calls.push(['artist', patch]);
            if (failCurrency && 'preferred_display_currency' in patch) throw new Error('column "preferred_display_currency" does not exist');
            Object.assign(artist, patch);
        },
        saveSetting: async (patch) => { h.calls.push(['setting', patch]); Object.assign(h.appSettings, patch); }
    };
    const keys = Object.keys(scope);
    h.saveRegion = new Function(...keys, `'use strict';\n${arrowSource('const saveRegion = async () => {')}\nreturn saveRegion;`)(...keys.map((k) => scope[k]));
    return h;
}

test('revisión #15: la región guarda la zona horaria y la moneda que muestra la página', async () => {
    const fresh = regionHarness({ artist: { preferred_display_currency: null, session_price_currency: 'ARS' } });
    await fresh.saveRegion();
    assert.deepEqual(fresh.calls, [
        ['artist', { country: 'Argentina', city: 'Córdoba' }],
        ['artist', { preferred_display_currency: 'ARS' }],
        ['setting', { country: 'Argentina', city: 'Córdoba', timezone: 'America/Argentina/Buenos_Aires' }]
    ], 'la moneda se guarda antes del aviso al panel (saveSetting)');
    assert.equal(fresh.dom.$('aac-country').value, 'Argentina');
    // Con eso el paso Configuración del servidor queda completo.
    const conf = stepOf(computeSteps({ artist: fresh.artist, prefs: { app_settings: fresh.appSettings } }), 'configuracion');
    assert.equal(checkOf(conf, 'region').done, true);
    assert.equal(checkOf(conf, 'moneda').done, true);
    assert.equal(conf.status, 'done');

    // Una moneda ya elegida no se pisa, y sin moneda visible no se escribe.
    const chosen = regionHarness({ artist: { preferred_display_currency: 'USD' }, currency: 'USD' });
    await chosen.saveRegion();
    const blank = regionHarness({ artist: {}, currency: '' });
    await blank.saveRegion();
    for (const h of [chosen, blank]) {
        assert.equal(h.calls.filter(([kind, patch]) => kind === 'artist' && 'preferred_display_currency' in patch).length, 0);
        assert.deepEqual(h.calls.at(-1), ['setting', { country: 'Argentina', city: 'Córdoba', timezone: 'America/Argentina/Buenos_Aires' }]);
    }

    // Si falla la moneda, la región y la zona horaria se guardan igual.
    const failing = regionHarness({ artist: {}, timezone: 'Europe/Madrid', failCurrency: true });
    await failing.saveRegion();
    assert.deepEqual(failing.calls.at(-1), ['setting', { country: 'Argentina', city: 'Córdoba', timezone: 'Europe/Madrid' }]);
    assert.equal(failing.calls.some(([kind]) => kind === 'toast'), false, 'sin aviso de error de región');
    assert.equal(failing.artist.preferred_display_currency, undefined);
});
