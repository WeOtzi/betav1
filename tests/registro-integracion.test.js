'use strict';

// Revisión del registro (12 nov 2026) · grupo integración.
// - Estilo "Añadir más adelante": el paso 03 y finalize aceptan registro sin estilo.
// - Bio con formato: cliente (bio-formatting.js) con la misma allowlist que el servidor.
// - Ubicación de estudio sin verificar (studios.location_verified, tolerante a su ausencia).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const registerJs = read('public/shared/js/register.js');
const finalJs = read('public/shared/js/acceso-register-final.js');
const bioJs = read('public/shared/js/bio-formatting.js');
const profileJs = read('public/shared/js/artist-profile.js');
const accountJs = read('public/shared/js/artist-account.js');
const accountHtml = read('public/artist/account/index.html');
const profileHtml = read('public/artist/profile/index.html');

// Extrae `function name(...) { ... }` con llaves balanceadas (ignora llaves en
// strings/regex simples de estas funciones, que no las tienen desbalanceadas).
function extractFunction(src, name) {
    const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
    const match = re.exec(src);
    assert.ok(match, `existe function ${name}`);
    let i = src.indexOf('{', match.index);
    let depth = 0;
    for (; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) return src.slice(match.index, i + 1);
        }
    }
    throw new Error(`function ${name} sin cierre`);
}

function stylesGate({ data = {}, search = '', apiLater } = {}) {
    const src = extractFunction(registerJs, 'stylesLaterAllowed') + '\n' + extractFunction(registerJs, 'stylesRequirementMet');
    const window = {
        location: { search },
        AccesoRegister: apiLater === undefined ? undefined : { stylesLaterRequested: () => apiLater }
    };
    const formState = { data };
    // eslint-disable-next-line no-new-func
    return new Function('window', 'formState', 'URLSearchParams', `${src}\nreturn { stylesLaterAllowed, stylesRequirementMet };`)(window, formState, URLSearchParams);
}

test('paso 03: sin "más adelante" el estilo sigue siendo obligatorio', () => {
    const g = stylesGate({ data: { styles: [] } });
    assert.equal(g.stylesLaterAllowed(), false);
    assert.equal(g.stylesRequirementMet({ styles: [] }), false);
    assert.equal(g.stylesRequirementMet({ styles: ['Realismo'] }), true);
    assert.equal(stylesGate({ apiLater: false }).stylesRequirementMet({ styles: [] }), false);
});

test('paso 03: con "más adelante" (URL, handoff o borrador) deja seguir sin estilo', () => {
    assert.equal(stylesGate({ search: '?draft=x&styleLater=1' }).stylesRequirementMet({ styles: [] }), true);
    assert.equal(stylesGate({ apiLater: true }).stylesRequirementMet({ styles: [] }), true);
    const fromDraft = stylesGate({ data: { styles: [], styles_later: true } });
    assert.equal(fromDraft.stylesRequirementMet({ styles: [], styles_later: true }), true);
});

test('paso 03: el gate, la validación y la revisión usan la regla de "más adelante"', () => {
    assert.match(extractFunction(registerJs, 'isGroupReady'), /case 'oficio':\s*return stylesRequirementMet\(data\) && Boolean\(data\.experience_years\);/);
    assert.match(registerJs, /case 4:\s*if \(!stylesRequirementMet\(formState\.data\)\) \{/);
    assert.match(extractFunction(registerJs, 'findFirstEmptyStep'), /if \(!stylesRequirementMet\(d\)\) return 4;/);
    assert.match(registerJs, /'Para más adelante'/);
    // "Empezar de cero" borra la marca.
    assert.match(extractFunction(registerJs, 'resetFormDataForStartOver'), /formState\.data\.styles_later = false;/);
    // acceso-register-final guarda la marca en el borrador y la expone.
    assert.match(finalJs, /data\.styles_later !== true && stylesLaterRequested\(\)/);
    assert.match(finalJs, /stylesLaterRequested,\n\s*offerResume/);
    assert.match(read('public/register-artist/index.html'), /podés seguir sin elegir uno/);
});

test('finalize/borrador: un registro sin estilos se acepta (styles_array vacío)', () => {
    const { buildArtistRegistrationPayload } = require('../lib/artist-registration');
    const payload = buildArtistRegistrationPayload({
        email: 'ana@example.com', full_name: 'Ana Prueba', artistic_name: 'ana.ink',
        styles: [], work_type: 'independent', city: 'Rosario'
    }, { status: 'incompleto' });
    assert.deepEqual(payload.styles_array, []);
    assert.equal(payload.estilo, '');
});

test('bio servidor: text-decoration con varios valores se conserva (split por espacios)', () => {
    const { sanitizeBioHtml } = require('../lib/bio-sanitizer');
    const out = sanitizeBioHtml('<span style="text-decoration: underline line-through">x</span>');
    assert.match(out, /text-decoration: underline line-through/);
    assert.match(sanitizeBioHtml('<span style="text-decoration: underline solid">y</span>'), /underline solid/);
});

test('bio cliente: misma allowlist que el servidor (mark, font-size con topes)', () => {
    assert.match(bioJs, /'del', 'mark',/);
    assert.match(bioJs, /mark: \[\]/);
    assert.match(bioJs, /'background', 'font-size',/);
    assert.match(bioJs, /\/var\\s\*\\\(\/i\.test\(normalized\)/);

    const start = bioJs.indexOf('const FONT_SIZE_KEYWORDS');
    const end = bioJs.indexOf('const ALLOWED_STYLE_PROPS');
    const consts = bioJs.slice(start, end);
    const src = consts + extractFunction(bioJs, 'rejectDangerousStyleValue') + '\n' + extractFunction(bioJs, 'normalizeFontSize');
    // eslint-disable-next-line no-new-func
    const clientSize = new Function(`${src}\nreturn normalizeFontSize;`)();
    const { sanitizeBioHtml } = require('../lib/bio-sanitizer');
    const serverSize = (value) => {
        const m = sanitizeBioHtml(`<span style="font-size: ${value}">t</span>`).match(/font-size: ([^";]+)/);
        return m ? m[1] : '';
    };
    for (const value of ['22px', '10px', '40px', '9px', '41px', '1.5em', '3em', 'large', '120%', 'calc(1px)', 'var(--x)', '0.6rem', '250%']) {
        assert.equal(clientSize(value), serverSize(value), `font-size ${value}`);
    }
});

test('perfil público: la bio con formato se renderiza completa, sin partir en manifiesto', () => {
    const fn = extractFunction(profileJs, 'bioHasRichFormat');
    // eslint-disable-next-line no-new-func
    const bioHasRichFormat = new Function(`${fn}\nreturn bioHasRichFormat;`)();
    assert.equal(bioHasRichFormat('<p>Hola. Soy tatuadora.</p>'), false);
    assert.equal(bioHasRichFormat('Hola<br>chau'), false);
    assert.equal(bioHasRichFormat('<p>Hola <mark>resaltado</mark></p>'), true);
    assert.equal(bioHasRichFormat('<p><span style="font-size: 22px">grande</span></p>'), true);
    assert.equal(bioHasRichFormat('<ul><li>a</li></ul>'), true);
    assert.match(extractFunction(profileJs, 'renderBio'), /hasRichFormat \? \{ manifesto: '', rest: plain \} : splitBioManifesto\(plain\)/);
    assert.match(extractFunction(profileJs, 'renderBio'), /window\.BioFormatting\.renderBioHtml\(bioTextEl, bio\)/);
});

test('cuenta: la bio usa WoRichText si existe y se guarda por POST /api/artist/profile/bio', () => {
    assert.match(extractFunction(accountJs, 'mountBioEditor'), /RT\.mount\(textarea, \{ maxLength: BIO_MAX_LENGTH \}\)/);
    assert.match(accountJs, /const BIO_MAX_LENGTH = 2000;/);
    assert.match(extractFunction(accountJs, 'saveBio'), /igApi\('\/api\/artist\/profile\/bio', \{ method: 'POST', body: \{ bio: next \|\| '' \} \}\)/);
    assert.doesNotMatch(extractFunction(accountJs, 'saveProfile'), /bio_description:/);
    assert.match(accountHtml, /id="aac-bio" rows="4" maxlength="2000"/);
    const dashboardJs = read('public/shared/js/dashboard.js');
    assert.match(extractFunction(dashboardJs, 'persistArtistBio'), /\/api\/artist\/profile\/bio/);
    assert.doesNotMatch(extractFunction(dashboardJs, 'saveBio'), /updateByUserId/);
});

test('ubicación de estudio: solo location_verified === false muestra el aviso (sin columna = verificado)', () => {
    for (const src of [profileJs, accountJs]) {
        const fn = extractFunction(src, 'isStudioLocationUnverified');
        // eslint-disable-next-line no-new-func
        const isUnverified = new Function(`${fn}\nreturn isStudioLocationUnverified;`)();
        assert.equal(isUnverified({ id: 's1' }), false, 'columna ausente');
        assert.equal(isUnverified({ id: 's1', location_verified: null }), false);
        assert.equal(isUnverified({ id: 's1', location_verified: true }), false);
        assert.equal(isUnverified({ id: 's1', location_verified: false }), true);
        assert.equal(isUnverified(null), false);
    }
    // No se pide la columna en un select explícito (falla mientras no exista).
    assert.doesNotMatch(profileJs, /select\([^)]*location_verified/);
    assert.doesNotMatch(accountJs, /location_verified,|, location_verified/);
    assert.match(extractFunction(accountJs, 'loadStudioVerification'), /getById\(studioId, '\*'\)/);
    assert.match(profileHtml, /id="studio-unverified" hidden/);
    assert.match(profileHtml, /Ubicación sin verificar/);
    assert.match(accountHtml, /id="aac-modalidad-studio-unverified" hidden/);
});
