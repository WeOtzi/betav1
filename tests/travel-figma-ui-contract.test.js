const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Travel exposes the nine requested Figma states in the existing product flow', () => {
    const page = read('public/artist/travel/index.html');

    for (const id of [
        'tv-view-dashboard',
        'tv-modal-create',
        'tv-view-success',
        'tv-view-detail',
        'tv-modal-edit',
        'tv-modal-dates',
        'tv-modal-link',
        'tv-modal-share',
        'tv-modal-cancel',
    ]) assert.match(page, new RegExp(`id="${id}"`), id);

    for (const copy of [
        'Crear viaje',
        'Viaje agregado a tu itinerario',
        'Editar viaje',
        'Cambiar fechas',
        'Vincular un estudio',
        'Compartir itinerario',
        'Cancelar viaje',
    ]) assert.match(page, new RegExp(copy, 'i'), copy);
});

test('Travel hero renders every Figma metric from persisted fields', () => {
    const page = read('public/artist/travel/index.html');
    const script = read('public/shared/js/artist-travel.js');
    const model = read('public/shared/js/travel-dashboard-model.js');

    for (const label of [
        'Días restantes',
        'Personas interesadas',
        'Días de estadía',
        'Clima en',
        'Estudios donde tatuarás',
    ]) assert.match(page, new RegExp(label, 'i'), label);

    assert.match(page, /id="tv-stat-interested"/i);
    assert.match(page, /id="tv-stat-climate"/i);
    assert.match(model, /interested_people_count/i);
    assert.match(model, /climate_celsius/i);
    assert.match(script, /contact_name/i);
});

test('share and cancel dialogs match the reference controls and exact copy', () => {
    const page = read('public/artist/travel/index.html');
    const script = read('public/shared/js/artist-travel.js');
    const publicShare = read('public/shared/js/travel-share.js');
    const server = read('server.js');

    assert.match(page, /Cualquier persona con este enlace podrá ver el itinerario de este viaje en modo lectura\./i);
    assert.match(page, /Enviar por/i);
    assert.match(page, />\s*Email\s*</i);
    assert.match(page, />\s*WhatsApp\s*</i);
    assert.doesNotMatch(page, /id="tvs-enabled"|tvm-togglerow/i);

    assert.match(page, /¿Estás seguro que querés cancelar este viaje\?/i);
    assert.match(page, /Esta acción se puede revertir más adelante desde el itinerario\./i);
    assert.doesNotMatch(page, /id="tv-cancel-reason"|Motivo \(opcional\)/i);
    assert.match(script, /travel\/t\//i);
    assert.match(publicShare, /location\.pathname|window\.location\.pathname/i);
    assert.match(server, /app\.get\('\/travel\/t\/:slug'/i);
});

test('Travel dialogs preserve keyboard focus and responsive content', () => {
    const page = read('public/artist/travel/index.html');
    const script = read('public/shared/js/artist-travel.js');
    const css = read('public/shared/css/artist-travel-ds.css');

    const dialogs = page.match(/role="dialog"/g) || [];
    assert.ok(dialogs.length >= 7, 'expected the seven requested action dialogs');
    assert.match(page, /aria-modal="true"/i);
    assert.match(page, /<label[^>]*for="tvs-url"[^>]*>[^<]*Enlace público del itinerario[^<]*<\/label>/i);
    assert.match(page, /id="tvs-url"[^>]*readonly[^>]*disabled/i);
    assert.match(page, /id="tvs-copy"[^>]*data-modal-initial-focus/i);
    assert.match(script, /Escape/);
    assert.match(script, /Tab/);
    assert.match(script, /focus(?:able|ables|Selector|Trap)/i);
    assert.match(script, /previouslyFocused|lastFocused|returnFocus|triggerElement/i);
    assert.match(page, /id="tv-s-title"[^>]*tabindex="-1"/i);
    assert.match(script, /id="tvd-title"[^>]*tabindex="-1"/i);
    assert.match(script, /closeModal\('tv-modal-create',\s*\{\s*restoreFocus:\s*false\s*\}\)/i);
    assert.match(script, /focusViewTarget\('tv-s-title'\)/i);
    assert.match(script, /focusViewTarget\('tvd-title'\)/i);
    assert.match(script, /act === 'reactivate'[\s\S]*?await refreshDetail\(\);\s*focusViewTarget\('tvd-title'\);\s*} else if \(act === 'edit-field'\)/i);
    assert.match(script, /STATUS_TAG_CLASS\[detailStatus\][\s\S]*STATUS_LABELS\[detailStatus\]/i);
    assert.match(script, /\['tv-modal-edit', 'tv-modal-dates', 'tv-modal-link', 'tv-modal-share', 'tv-modal-cancel'\]\.includes\(id\)[\s\S]*setDetailHeaderStatus\('confirmado'\)/i);
    assert.match(script, /id="tvd-status-tag"/i);
    assert.match(script, /guest_spot:\s*'Guest Spot'/i);
    assert.match(page, /<weotzi-travel-globe\b[^>]*id="tv-globe"/i);
    assert.match(script, /setTravelData\s*\(/);
    assert.match(script, /https:\/\/weotzi\.com\/travel\/t\//i);
    assert.match(script, /Agregar tarea…/);
    assert.match(script, /data-act="doc-del"[^>]*data-doc=/i);
    assert.match(script, /Teléfono \/ contacto/i);
    assert.match(script, /Condiciones acordadas/i);
    assert.match(script, /Tus notas/i);
    assert.match(css, /\.tvs-title:focus,\.tvd-title:focus\{outline:none\}/i);
    assert.match(css, /body\.wo-app\{margin:0\}/i);
    assert.match(css, /\.tvl-shell\{width:100%;max-width:1688px;padding:40px 44px 0\}/i);
    assert.doesNotMatch(css, /\.wo-app \.wo-oam-badge\{display:none\}/i);
    assert.match(css, /\.wo-app \.wo-btn--direct\{background:var\(--blue-300\);border-color:var\(--blue-300\)\}/i);
    assert.match(css, /#tv-modal-create\{align-items:flex-start;padding:275px 24px 24px\}/i);
    assert.match(css, /#tv-modal-create \.tvm--create\{margin-top:0;transform:translateX\(-18\.5px\)\}/i);
    assert.match(css, /\.tvm-warnrow\{[^}]*height:24px/i);
    assert.match(css, /\.tvm-warnrow\{[^}]*height:auto/i);
    assert.match(css, /\.tvm-warnrow>div\{[^}]*width:auto[^}]*flex:1[^}]*min-width:0/i);
    assert.doesNotMatch(css, /\.tvm\s+\[data-modal-initial-focus\]:focus-visible\{[^}]*box-shadow:none/i);
    assert.match(css, /grid-template-columns:minmax\(0,776px\) minmax\(0,360px\)/i);
    assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,21\.71875%\)\) minmax\(0,18\.125%\)/i);
    assert.match(css, /grid-template-columns:minmax\(0,3fr\) minmax\(0,1fr\)[^}]*aspect-ratio:1280\/988/i);

    assert.doesNotMatch(css, /@media\s*\(\s*max-width/i);
    assert.match(css, /@media\s*\(min-width:\s*769px\)/i);
    assert.match(css, /@media\s*\(min-width:\s*1025px\)/i);
    assert.match(css, /@media\s*\(min-width:\s*1280px\)/i);
    assert.match(css, /overflow-x:\s*clip/i);
    assert.match(page, /id="tvdoc-file"[^>]*accept="[^"]*application\/pdf/i);
});
