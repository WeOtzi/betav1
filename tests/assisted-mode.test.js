const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Modo asistido (oct 2026): panel wo-assist.js + wo-assist.css. Se prueba la
// lógica pura expuesta en WoAssist._internal (copy, mensajes de bio, anclas,
// orden de pasos, markup del panel y de la bienvenida) y las reglas del DS.

const root = path.resolve(__dirname, '..');
const JS_FILE = path.join(root, 'public/shared/js/wo-assist.js');
const CSS_FILE = path.join(root, 'public/shared/css/wo-assist.css');
const jsSource = fs.readFileSync(JS_FILE, 'utf8');
const cssSource = fs.readFileSync(CSS_FILE, 'utf8');

// Contrato §1 (ids estables, orden y títulos).
const CONTRACT_STEPS = ['perfil', 'portafolio', 'compartir', 'retiro', 'disponibilidad', 'notificaciones', 'verificacion', 'configuracion'];
const CONTRACT_TITLES = {
    perfil: 'Completá tu perfil',
    portafolio: 'Validá tu Instagram y tu portafolio',
    compartir: 'Compartí tu perfil en Instagram',
    retiro: 'Configurá un medio de retiro',
    disponibilidad: 'Configurá tu disponibilidad',
    notificaciones: 'Configurá tus notificaciones',
    verificacion: 'Completá la verificación',
    configuracion: 'Completá la configuración',
};
const CONTRACT_CHECKS = {
    perfil: [['banner', false], ['foto', false], ['redes', false], ['whatsapp', false], ['email', false], ['bio', true]],
    portafolio: [['trabajos', false], ['instagram_validado', false], ['portafolio_validado', false]],
    compartir: [['enlace_copiado', true], ['bio_copiada', true], ['pegado', false]],
    retiro: [['destino', false]],
    disponibilidad: [['modalidad', false], ['estudio', false], ['horarios', false]],
    notificaciones: [['preferencias', false]],
    verificacion: [['identidad', false], ['domicilio', false], ['bioseguridad', true], ['solicitud', false]],
    configuracion: [['region', false], ['moneda', false], ['revisada', true]],
};

function loadAssist(extraWindow) {
    const listeners = {};
    const document = {
        readyState: 'complete',
        documentElement: { classList: { add() {}, remove() {}, toggle() {} } },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getElementById() { return null; },
    };
    const window = Object.assign({
        location: { pathname: '/artist/dashboard', hash: '', search: '', href: 'https://beta.weotzi.com/artist/dashboard' },
        document,
    }, extraWindow || {});
    window.window = window;
    const sandbox = { window, document, console, setTimeout, clearTimeout, setInterval, clearInterval };
    vm.createContext(sandbox);
    vm.runInContext(jsSource, sandbox, { filename: 'wo-assist.js' });
    return { api: window.WoAssist, window, listeners };
}
// Los objetos del sandbox son de otro realm: se comparan como JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

function onboarding(statuses, extra) {
    statuses = statuses || {};
    const steps = CONTRACT_STEPS.map((id) => {
        const status = statuses[id] || 'pending';
        return {
            id, title: CONTRACT_TITLES[id], status,
            checks: CONTRACT_CHECKS[id].map(([cid, optional]) => ({ id: cid, label: 'Check ' + cid, done: status === 'done', optional })),
        };
    });
    const pending = steps.filter((s) => s.status === 'pending');
    return Object.assign({
        success: true, user_id: 'u-1', username: 'laura.wo', artist_name: 'Laura',
        profile_url: 'https://beta.weotzi.com/artist/profile?artist=laura',
        onboarding: { demo_suggestions: true, assisted: { active: true, started_at: '2026-10-30T10:00:00Z', completed_at: null, welcome_seen_at: null, acknowledged: {}, skipped: {} } },
        steps,
        current_step: pending.length ? pending[0].id : null,
        completed: pending.length === 0,
        progress: { done: steps.filter((s) => s.status === 'done').length, total: 8 },
    }, extra || {});
}
const countAccent = (html) => (html.match(/wo-btn--accent/g) || []).length;

const { api } = loadAssist();
const I = api._internal;

/* --------------------------------- API --------------------------------- */

test('WoAssist expone la API del contrato §6 y los internos para tests', () => {
    for (const fn of ['boot', 'open', 'close', 'refresh', 'isActive', 'state']) assert.equal(typeof api[fn], 'function', fn);
    assert.equal(api.isActive(), false, 'no se monta solo al cargar');
    for (const key of ['BIO_MESSAGES', 'STEP_COPY']) assert.ok(I[key], key);
    for (const fn of ['pickMessage', 'sectionForStep', 'anchorSelectors']) assert.equal(typeof I[fn], 'function', fn);
});

test('con el demo activo el panel no hace nada', async () => {
    const { api: demoApi } = loadAssist({ WoDemo: { enabled: true } });
    assert.equal(await demoApi.boot({ start: true, identity: { userId: 'u-1' } }), false);
    assert.equal(await demoApi.open(), false);
    assert.equal(demoApi.isActive(), false);
});

/* --------------------------------- copy --------------------------------- */

test('STEP_COPY cubre exactamente los ocho pasos del contrato, en orden y con sus títulos', () => {
    assert.deepEqual(plain(Object.keys(I.STEP_COPY)), CONTRACT_STEPS);
    assert.deepEqual(plain(I.STEP_IDS), CONTRACT_STEPS);
    for (const id of CONTRACT_STEPS) {
        const copy = I.STEP_COPY[id];
        assert.equal(copy.title, CONTRACT_TITLES[id], id + ': título del contrato');
        assert.ok(copy.description && copy.description.length > 60, id + ': tiene descripción');
        for (const [cid] of CONTRACT_CHECKS[id]) assert.ok(copy.checks[cid], id + '.' + cid + ': etiqueta de respaldo');
    }
    assert.match(I.STEP_COPY.verificacion.description, /bioseguridad es opcional/);
    assert.match(I.STEP_COPY.perfil.description, /biografía es opcional/i);
    assert.equal(I.STEP_COPY.retiro.unavailable, 'El Wallet todavía no está activo en tu cuenta: este paso se habilita pronto.');
});

test('los mensajes para la bio son 16 o más, únicos, cortos, sin exclamaciones ni emoji', () => {
    const messages = plain(I.BIO_MESSAGES);
    assert.ok(messages.length >= 16, 'hay ' + messages.length);
    assert.equal(new Set(messages).size, messages.length, 'sin repetidos');
    for (const m of messages) {
        assert.ok(m.length > 0 && m.length <= 40, m + ' (' + m.length + ' caracteres)');
        assert.equal(m, m.trim());
        assert.doesNotMatch(m, /[!¡]/, m);
        assert.doesNotMatch(m, /\p{Extended_Pictographic}/u, m + ': sin emoji');
        assert.doesNotMatch(m, /https?:|www\./, m + ': el enlace va aparte');
    }
    for (const sample of ['Agendá conmigo en el enlace', 'Cotizá fácil desde el enlace', 'Pedí tu cotización en el enlace', 'Reservá tu turno en el enlace']) {
        assert.ok(messages.includes(sample), sample);
    }
});

test('pickMessage nunca repite el mensaje actual, con cualquier aleatorio', () => {
    const messages = plain(I.BIO_MESSAGES);
    const rnds = [0, 0.1, 0.5, 0.9999999, 1, 1.5, -1, NaN];
    for (const current of messages) {
        for (const r of rnds) {
            const next = I.pickMessage(current, () => r);
            assert.notEqual(next, current, 'rnd ' + r);
            assert.ok(messages.includes(next));
        }
    }
    let previous = messages[0];
    for (let i = 0; i < 300; i++) {
        const next = I.pickMessage(previous);
        assert.notEqual(next, previous);
        previous = next;
    }
    assert.ok(messages.includes(I.pickMessage(null)), 'sin mensaje actual elige cualquiera');
});

/* ------------------------------- anclas ------------------------------- */

test('cada paso apunta a su sección del centro de cuenta (compartir vive en el panel)', () => {
    const expected = { perfil: 'perfil', portafolio: 'portafolio', compartir: null, retiro: 'cobros', disponibilidad: 'disponibilidad', notificaciones: 'notificaciones', verificacion: 'verificacion', configuracion: 'configuracion' };
    for (const id of CONTRACT_STEPS) assert.equal(I.sectionForStep(id), expected[id], id);
    assert.equal(I.sectionForStep('soporte'), null);
    assert.equal(I.sectionForStep('constructor'), null, 'no lee propiedades heredadas');
});

test('anchorSelectors usa ~= (lista separada por espacios) del check al paso y cae a la sección', () => {
    assert.deepEqual(plain(I.anchorSelectors('perfil', 'banner')), ['[data-assist~="perfil.banner"]', '[data-assist~="perfil"]', '#aac-perfil']);
    assert.deepEqual(plain(I.anchorSelectors('retiro', 'destino')), ['[data-assist~="retiro.destino"]', '[data-assist~="retiro"]', '#aac-cobros']);
    assert.deepEqual(plain(I.anchorSelectors('disponibilidad')), ['[data-assist~="disponibilidad"]', '#aac-disponibilidad']);
    assert.deepEqual(plain(I.anchorSelectors('compartir', 'pegado')), ['[data-assist~="compartir.pegado"]', '[data-assist~="compartir"]']);
    for (const id of CONTRACT_STEPS) {
        for (const [cid] of CONTRACT_CHECKS[id]) {
            const sels = I.anchorSelectors(id, cid);
            assert.ok(sels.filter((s) => s.startsWith('[data-assist')).every((s) => s.includes('~=')), id + '.' + cid);
            assert.equal(sels[0], '[data-assist~="' + id + '.' + cid + '"]');
        }
    }
    // Ids raros no se inyectan en el selector.
    assert.deepEqual(plain(I.anchorSelectors('perfil"] , body', 'x')), []);
    assert.deepEqual(plain(I.anchorSelectors('perfil', 'a"]')), ['[data-assist~="perfil"]', '#aac-perfil']);
});

/* ------------------------------ orden de pasos ------------------------------ */

test('normalizeSteps respeta el orden del contrato y completa lo que falte', () => {
    const steps = plain(I.normalizeSteps({ steps: [
        { id: 'retiro', status: 'unavailable', checks: [{ id: 'destino', done: false }] },
        { id: 'perfil', status: 'done', title: 'Completá tu perfil', checks: [{ id: 'bio', label: 'Biografía', done: true, optional: true }] },
        { id: 'raro', status: 'done' },
        { id: 'portafolio', status: 'whatever' },
    ] }));
    assert.deepEqual(steps.map((s) => s.id), CONTRACT_STEPS);
    assert.deepEqual(steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(steps[0].status, 'done');
    assert.equal(steps[1].status, 'pending', 'status desconocido = pending');
    assert.equal(steps[3].status, 'unavailable');
    assert.equal(steps[3].checks[0].label, 'Destino de retiro activo', 'etiqueta de respaldo de STEP_COPY');
    assert.equal(steps[4].title, 'Configurá tu disponibilidad');
});

test('nextStepAfter salta lo hecho o postergado, muestra una vez lo no disponible y vuelve al inicio', () => {
    const steps = I.normalizeSteps(onboarding({ perfil: 'done', portafolio: 'pending', compartir: 'done', retiro: 'unavailable', disponibilidad: 'skipped', notificaciones: 'pending', verificacion: 'done', configuracion: 'done' }));
    assert.equal(I.nextStepAfter(steps, 'portafolio', {}), 'retiro');
    assert.equal(I.nextStepAfter(steps, 'portafolio', { retiro: 1 }), 'notificaciones');
    assert.equal(I.nextStepAfter(steps, 'notificaciones', {}), 'portafolio', 'vuelve al primer pendiente');
    const allDone = I.normalizeSteps(onboarding(Object.fromEntries(CONTRACT_STEPS.map((id) => [id, 'done']))));
    assert.equal(I.nextStepAfter(allDone, 'perfil', {}), null);
});

test('firstPendingCheck prioriza los obligatorios y deja los opcionales para el final', () => {
    const step = { checks: [{ id: 'bio', done: false, optional: true }, { id: 'banner', done: true, optional: false }, { id: 'foto', done: false, optional: false }] };
    assert.equal(I.firstPendingCheck(step).id, 'foto');
    step.checks[2].done = true;
    assert.equal(I.firstPendingCheck(step).id, 'bio');
    step.checks[0].done = true;
    assert.equal(I.firstPendingCheck(step), null);
});

/* ------------------------------- markup ------------------------------- */

const CTX = { narrator: true, rateLabel: '1,25×' };

test('el panel nunca suma un botón accent (el de la página manda) en ningún estado', () => {
    const variants = [];
    for (const id of CONTRACT_STEPS) {
        for (const status of ['pending', 'skipped', 'unavailable', 'done']) {
            variants.push([id + '/' + status, I.buildPanelModel(onboarding({ [id]: status }), { view: id, bio: 'Agendá conmigo en el enlace' }, CTX)]);
        }
    }
    variants.push(['completo', I.buildPanelModel(onboarding(Object.fromEntries(CONTRACT_STEPS.map((id) => [id, 'done']))), {}, CTX)]);
    variants.push(['cargando', I.buildPanelModel(null, {}, { loading: true })]);
    variants.push(['error', I.buildPanelModel(null, {}, { error: true })]);
    variants.push(['salir', I.buildPanelModel(onboarding(), {}, { confirmExit: true })]);
    for (const [name, model] of variants) {
        const html = I.renderPanel(model);
        assert.ok(countAccent(html) <= 1, name + ': como mucho un accent');
        assert.equal(countAccent(html), 0, name + ': el primario del panel es ink');
        assert.doesNotMatch(html, /[!¡]/, name + ': sin exclamaciones');
        assert.doesNotMatch(html, /fa-|<svg/, name + ': íconos Feather vía data-wo-icon');
    }
});

test('el paso pendiente muestra eyebrow, checklist con opcionales y las acciones del contrato', () => {
    const html = I.renderPanel(I.buildPanelModel(onboarding(), {}, CTX));
    assert.match(html, /Modo asistido · paso 1 de 8/);
    assert.match(html, /<h2 class="wo-assist__title" id="wo-assist-title" tabindex="-1">Completá tu perfil<\/h2>/);
    assert.match(html, /data-wo-icon="circle"/);
    assert.match(html, /Check bio<\/span><span class="wo-assist__opt">Opcional<\/span>/);
    assert.match(html, /data-assist-act="go"[^>]*>IR AL PASO →</);
    assert.match(html, /data-assist-act="later"[^>]*>LO HAGO DESPUÉS</);
    assert.match(html, /data-assist-act="listen"[^>]*>.*ESCUCHAR/);
    assert.match(html, /aria-label="Velocidad de narración: 1,25×"/);
    assert.match(html, /aria-label="Minimizar el modo asistido"/);
    assert.match(html, /aria-label="Salir del modo asistido"/);
    assert.match(html, />Ver todos los pasos</);
    const listed = [...html.matchAll(/data-assist-act="pick-step" data-step="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(listed, CONTRACT_STEPS, 'la lista tiene los ocho pasos en orden');
    assert.match(html, /<ol class="wo-assist__steps" id="wo-assist-steps"[^>]* hidden>/, 'la lista arranca plegada');
    const done = I.renderPanel(I.buildPanelModel(onboarding({ perfil: 'done' }), { view: 'perfil' }, CTX));
    assert.match(done, /data-wo-icon="check-circle"/);
    assert.match(done, /Este paso ya está listo/);
    const noVoice = I.renderPanel(I.buildPanelModel(onboarding(), {}, { narrator: false }));
    assert.doesNotMatch(noVoice, /ESCUCHAR/, 'sin narrador no se ofrece la voz');
});

test('compartir arma el enlace, el mensaje de bio y las instrucciones de Instagram dentro del panel', () => {
    const data = onboarding({ perfil: 'done', portafolio: 'done' });
    const model = I.buildPanelModel(data, { bio: 'Reservá tu turno en el enlace' }, CTX);
    assert.equal(model.viewId, 'compartir');
    const html = I.renderPanel(model);
    assert.match(html, /Modo asistido · paso 3 de 8/);
    assert.match(html, /<input class="wo-assist__field" id="wo-assist-link" type="text" readonly value="https:\/\/beta\.weotzi\.com\/artist\/profile\?artist=laura">/);
    assert.match(html, />COPIAR ENLACE</);
    assert.match(html, /En Instagram: Editar perfil → Enlaces → Agregar enlace externo\. Pegá este enlace en el campo URL\./);
    assert.match(html, /<textarea[^>]*id="wo-assist-bio"[^>]*readonly>Reservá tu turno en el enlace<\/textarea>/);
    assert.match(html, />GENERAR OTRO</);
    assert.match(html, />COPIAR MENSAJE</);
    assert.match(html, /Pegalo al final de tu presentación sin borrar lo que ya tenés\./);
    assert.match(html, /<a [^>]*href="https:\/\/www\.instagram\.com\/accounts\/edit\/" target="_blank" rel="noopener">ABRIR INSTAGRAM →<\/a>/);
    assert.match(html, /data-assist-act="pasted"[^>]*>YA LO PEGUÉ EN MI INSTAGRAM</);
    assert.doesNotMatch(html, /IR AL PASO/, 'compartir no tiene página propia');
    const copied = I.renderPanel(I.buildPanelModel(data, {}, Object.assign({ copied: 'link' }, CTX)));
    assert.match(copied, />COPIADO</);
    const unsafe = I.renderPanel(I.buildPanelModel(onboarding({ perfil: 'done', portafolio: 'done' }, { profile_url: 'javascript:alert(1)' }), {}, CTX));
    assert.doesNotMatch(unsafe, /javascript:/, 'solo enlaces http(s)');
    assert.match(unsafe, /Todavía no encontramos tu enlace público/);
});

test('retiro sin Wallet muestra el aviso y CONTINUAR → en lugar de las acciones del paso', () => {
    const html = I.renderPanel(I.buildPanelModel(onboarding({ retiro: 'unavailable' }), { view: 'retiro' }, CTX));
    assert.match(html, /El Wallet todavía no está activo en tu cuenta: este paso se habilita pronto\./);
    assert.match(html, /data-assist-act="continue"[^>]*>CONTINUAR →</);
    assert.doesNotMatch(html, /LO HAGO DESPUÉS|IR AL PASO/);
});

test('con todo completo el panel ofrece la bienvenida y la lista suma la entrada para reabrirla', () => {
    const all = onboarding(Object.fromEntries(CONTRACT_STEPS.map((id) => [id, 'done'])));
    const html = I.renderPanel(I.buildPanelModel(all, { stepsOpen: true }, CTX));
    assert.match(html, /Modo asistido · completo/);
    assert.match(html, /data-assist-act="welcome"[^>]*>VER BIENVENIDA →</);
    assert.match(html, /Bienvenida a We Ötzi/);
    assert.doesNotMatch(html, /id="wo-assist-steps"[^>]* hidden/);
    const confirm = I.renderPanel(I.buildPanelModel(all, {}, { confirmExit: true }));
    assert.match(confirm, /¿Salir del modo asistido\?<\/h2><p class="wo-assist__desc">Podés retomarlo desde el menú Ö\.<\/p>/);
});

test('la bienvenida final es un diálogo modal accesible con un solo accent y todo el contenido pedido', () => {
    const w = I.buildWelcomeModel(onboarding({}, { completed: true }), { name: 'Otro' }, { narrator: true });
    const html = I.renderWelcome(w);
    assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="wo-assist-welcome-title"/);
    assert.match(html, /id="wo-assist-welcome-title" tabindex="-1">Felicitaciones, Laura: tu perfil está listo</);
    assert.match(html, /Bienvenido a We Ötzi/);
    assert.match(html, /Todo lo que podés hacer en We Ötzi/);
    for (const name of ['Cotizaciones', 'Calendario', 'Job board', 'Spots e invitaciones', 'Travel', 'Inbox', 'Estadísticas', 'Wallet']) {
        assert.match(html, new RegExp('<b>' + name + '</b>'), name);
    }
    assert.match(html, /Por qué conviene que tus clientes coticen con We Ötzi/);
    for (const re of [/idea, zona, tamaño, referencias y presupuesto/, /historial y sin mensajes perdidos/, /cotizador las 24 horas/, /recordatorios conectados/, /señas protegidos en el Wallet/, /Reseñas verificadas/, /cancelaciones, disputas o dudas/]) {
        assert.match(html, re);
    }
    assert.match(html, /Inbox → Soporte/);
    assert.match(html, /href="mailto:artistas@weotzi\.com"/);
    assert.equal(countAccent(html), 1, 'un solo accent por vista');
    assert.match(html, /wo-btn--accent[^"]*" href="\/artist\/dashboard" data-welcome-act="panel">IR A MI PANEL →</);
    assert.match(html, /href="https:\/\/beta\.weotzi\.com\/artist\/profile\?artist=laura" target="_blank" rel="noopener">VER MI PERFIL PÚBLICO</);
    assert.match(html, />ESCUCHAR</);
    assert.doesNotMatch(html, /[!¡]/);
    const anon = I.renderWelcome(I.buildWelcomeModel({ artist_name: '' }, null, {}));
    assert.match(anon, />Felicitaciones: tu perfil está listo</);
    assert.doesNotMatch(anon, /VER MI PERFIL PÚBLICO|ESCUCHAR/);
    const hostile = I.renderWelcome(I.buildWelcomeModel({ artist_name: '<img src=x onerror=1>' }, null, {}));
    assert.doesNotMatch(hostile, /<img/);
});

test('los enlaces internos respetan el base path /beta', () => {
    const { api: beta } = loadAssist({ location: { pathname: '/beta/artist/account', hash: '#perfil', search: '', href: 'https://weotzi.com/beta/artist/account#perfil' } });
    assert.equal(beta._internal.appPath('/artist/dashboard'), '/beta/artist/dashboard');
    assert.equal(beta._internal.appPath('/beta/artist/dashboard'), '/beta/artist/dashboard');
    assert.equal(beta._internal.localPath(), '/artist/account');
    const html = beta._internal.renderWelcome(beta._internal.buildWelcomeModel({ artist_name: 'Laura' }, null, {}));
    assert.match(html, /href="\/beta\/artist\/dashboard"/);
    assert.match(html, /href="\/beta\/artist\/inbox"/);
});

/* ------------------------------- fuente ------------------------------- */

// Literales de string del JS (sin comentarios); el archivo no usa template strings.
function stringLiterals(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i], d = src[i + 1];
        if (c === '/' && d === '/') { const j = src.indexOf('\n', i); i = j === -1 ? src.length : j; continue; }
        if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); i = j === -1 ? src.length : j + 2; continue; }
        if (c === "'" || c === '"') {
            let j = i + 1, s = '';
            while (j < src.length && src[j] !== c) {
                if (src[j] === '\\') { s += src.slice(j, j + 2); j += 2; continue; }
                s += src[j]; j += 1;
            }
            out.push(s);
            i = j + 1;
            continue;
        }
        i += 1;
    }
    return out;
}

test('el copy de wo-assist.js no usa signos de exclamación (regla 10 del DS)', () => {
    assert.doesNotMatch(jsSource, /¡/);
    assert.doesNotMatch(jsSource, /`/, 'sin template strings (ES5 como wo-tour.js)');
    const literals = stringLiterals(jsSource);
    assert.ok(literals.length > 200, 'el escáner encontró los textos (' + literals.length + ')');
    assert.ok(literals.includes('Completá tu perfil'));
    const offenders = literals.filter((s) => s.includes('!'));
    assert.deepEqual(offenders, []);
});

test('el panel cumple el contrato: datos por WoDemo o fetch propio, eventos de refresco y voz compartida', () => {
    assert.doesNotMatch(jsSource, /rest\/v1|_supabase\.from\(/, 'sin PostgREST directo desde el panel');
    assert.match(jsSource, /window\.WoDemo\.onboarding\(/);
    assert.match(jsSource, /window\.WoDemo\.api\(API_PATH/);
    assert.match(jsSource, /client\.auth\.getSession\(\)/);
    assert.match(jsSource, /\^sb-\.\+-auth-token\$/);
    assert.match(jsSource, /'wo:assist-refresh'/);
    assert.match(jsSource, /'visibilitychange'/);
    assert.match(jsSource, /'hashchange'/);
    assert.match(jsSource, /var REFRESH_DEBOUNCE_MS = 600;/);
    assert.match(jsSource, /var POLL_MS = 30000;/);
    assert.match(jsSource, /window\.WoTour && window\.WoTour\.narrator/);
    assert.match(jsSource, /execCommand\('copy'\)/, 'respaldo sin navigator.clipboard');
    assert.match(jsSource, /root\.setAttribute\('role', 'complementary'\);\s*root\.setAttribute\('aria-label', 'Modo asistido'\);/);
    assert.match(jsSource, /classList\.add\('wo-assist-on'\)/);
    assert.match(jsSource, /\[data-aac-nav="' \+ section \+ '"\]/);
    assert.match(jsSource, /behavior: reducedMotion\(\) \? 'auto' : 'smooth'/);
    for (const ack of ["acknowledge: 'compartir'", "ack('compartir.enlace')", "ack('compartir.bio')", 'welcome_seen: true', 'active: false', 'skip: stepId', 'unskip: stepId']) {
        assert.ok(jsSource.includes(ack), ack);
    }
});

/* --------------------------------- CSS --------------------------------- */

function cssRules(css) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(clean)) !== null) out.push({ selector: m[1].trim(), body: m[2] });
    return out;
}

test('wo-assist.css usa solo tokens, radius 0, sin sombras en reposo y con guardas [hidden]', () => {
    const css = cssSource.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'sin hex');
    assert.doesNotMatch(css, /rgba?\(|hsla?\(/, 'colores siempre desde tokens');
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /\.wo-assist\[hidden\][^{]*\.wo-assist-welcome\[hidden\]\{display:none !important\}/);
    for (const rule of cssRules(cssSource)) {
        const radius = /border-radius\s*:\s*([^;]+)/.exec(rule.body);
        if (radius) assert.match(radius[1].trim(), /^(0|var\(--radius-none\))$/, rule.selector + ': radius 0');
        const shadow = /box-shadow\s*:\s*([^;]+)/.exec(rule.body);
        if (shadow && shadow[1].trim() !== 'none') assert.match(rule.selector, /:hover|:focus/, rule.selector + ': sombra solo como feedback');
        if (/\[hidden\]/.test(rule.selector) && !rule.selector.includes(':not([hidden])')) {
            assert.doesNotMatch(rule.body, /display\s*:\s*(flex|grid|block|inline)/, rule.selector);
        }
        const family = /font-family\s*:\s*([^;]+)/.exec(rule.body);
        if (family) assert.match(family[1].trim(), /^var\(--font-(display|body|mono)\)$/, rule.selector + ': tipografías por token');
    }
});

test('las capas quedan debajo del recorrido (1400) y el layout entra en 320 px', () => {
    const z = {};
    for (const rule of cssRules(cssSource)) {
        const m = /z-index\s*:\s*(\d+)/.exec(rule.body);
        if (m) z[rule.selector] = Number(m[1]);
    }
    assert.ok(z['.wo-assist'] > 1000 && z['.wo-assist'] < 1400, 'panel sobre la página y debajo del recorrido');
    assert.ok(z['.wo-assist-ring'] < z['.wo-assist'], 'el marco no tapa el panel');
    assert.ok(z['.wo-assist-welcome'] > z['.wo-assist'] && z['.wo-assist-welcome'] < 1400, 'bienvenida entre panel y recorrido');
    assert.match(cssSource, /\.wo-assist-ring\{[^}]*pointer-events:none/, 'el marco no bloquea clicks');
    // Fuera de media queries no hay anchos fijos mayores a 320 px.
    const base = cssSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    for (const m of base.matchAll(/(?:^|[;{\s])(min-width|width)\s*:\s*(\d+)px/g)) {
        assert.ok(Number(m[2]) <= 320, m[0]);
    }
    assert.match(cssSource, /@media \(min-width:48rem\)\{[\s\S]*width:min\(380px,calc\(100vw - var\(--space-8\)\)\)/, 'panel de ~380 px desde 768 px');
    assert.match(cssSource, /\.wod-body \.wo-assist\{--wo-assist-bottom:var\(--space-16\)\}/, 'sobre la bottombar del dashboard');
});

test('táctil: herramientas, enlaces y campos del dock miden 44 px en móvil y vuelven a 36 px desde 768 px', () => {
    const clean = cssSource.replace(/\/\*[\s\S]*?\*\//g, '');
    const desktop = /@media \(min-width:48rem\)\{([\s\S]*?)\n\}/.exec(clean);
    assert.ok(desktop, 'bloque de escritorio');
    const base = clean.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    for (const sel of ['.wo-assist__tool', '.wo-assist__link', '.wo-assist__field']) {
        const rule = cssRules(base).find((r) => r.selector === sel);
        assert.ok(rule, sel);
        assert.match(rule.body, /min-height:var\(--tap-target-min\)/, sel + ': 44 px en táctil');
        assert.doesNotMatch(rule.body, /--control-h-sm/, sel + ': nada de 36 px fuera del bloque de escritorio');
    }
    assert.match(desktop[1], /\.wo-assist__tool,\.wo-assist__link,\.wo-assist__field\{min-height:var\(--control-h-sm\)\}/);
});

test('el CTA accent de la bienvenida es un <a>: su texto vuelve a --action-accent-fg (no el azul de enlace)', () => {
    const clean = cssSource.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = cssRules(clean).find((r) => r.selector.split(',').map((s) => s.trim()).includes('.wo-assist-welcome a.wo-btn--accent'));
    assert.ok(rule, 'regla para el <a> accent dentro de la bienvenida');
    assert.match(rule.body, /^color:var\(--action-accent-fg\)$/);
    assert.ok(rule.selector.includes('.wo-assist-welcome a.wo-btn--accent:hover'), 'también en hover');
    // (0,2,1) le gana a `.wo-app a` (0,1,1) del DS sin !important.
    assert.doesNotMatch(rule.body, /!important/);
});

/* ------------------------- markup de los fixes ------------------------- */

test('portafolio sin el módulo de Instagram suma una línea: por ahora alcanza con cargar trabajos', () => {
    const NOTE = 'La validación de Instagram se habilita pronto: por ahora cargá tus trabajos.';
    const off = onboarding({ perfil: 'done' }, { instagram: { available: false } });
    const model = I.buildPanelModel(off, {}, CTX);
    assert.equal(model.viewId, 'portafolio');
    const html = I.renderPanel(model);
    assert.ok(html.includes('<p class="wo-assist__desc wo-assist__extra">' + NOTE + '</p>'), 'la línea va debajo de la descripción');
    assert.equal(html.split(NOTE).length - 1, 1, 'una sola vez');
    assert.doesNotMatch(html, /[!¡]/);
    const on = I.renderPanel(I.buildPanelModel(onboarding({ perfil: 'done' }, { instagram: { available: true } }), {}, CTX));
    assert.ok(!on.includes(NOTE), 'con Instagram disponible no aparece');
    const missing = I.renderPanel(I.buildPanelModel(onboarding({ perfil: 'done' }), {}, CTX));
    assert.ok(!missing.includes(NOTE), 'sin el objeto instagram no se asume nada');
    const other = I.renderPanel(I.buildPanelModel(onboarding({}, { instagram: { available: false } }), { view: 'perfil' }, CTX));
    assert.ok(!other.includes(NOTE), 'solo en el paso portafolio');
});

test('notificaciones y configuración ofrecen "Ya lo revisé" (ghost); el resto de los pasos no', () => {
    const reviewed = /<button type="button" class="wo-btn wo-btn--s wo-btn--ghost wo-assist__btn" data-assist-act="reviewed">Ya lo revisé<\/button>/;
    for (const id of ['notificaciones', 'configuracion']) {
        for (const status of ['pending', 'skipped']) {
            const html = I.renderPanel(I.buildPanelModel(onboarding({ [id]: status }), { view: id }, CTX));
            assert.match(html, reviewed, id + '/' + status);
            assert.equal(countAccent(html), 0, id + '/' + status + ': sin accent');
        }
        const done = I.renderPanel(I.buildPanelModel(onboarding({ [id]: 'done' }), { view: id }, CTX));
        assert.doesNotMatch(done, /data-assist-act="reviewed"/, id + '/done');
    }
    for (const id of CONTRACT_STEPS.filter((s) => s !== 'notificaciones' && s !== 'configuracion')) {
        const html = I.renderPanel(I.buildPanelModel(onboarding(), { view: id }, CTX));
        assert.doesNotMatch(html, /data-assist-act="reviewed"/, id);
    }
});

test('el acceso al demo del dock es un enlace simple, sin accent, y solo aparece cuando el modelo lo pide', () => {
    const link = '<button type="button" class="wo-assist__link wo-assist__demo" data-assist-act="demo">Probá el modo demo →</button>';
    const withLink = I.renderPanel(I.buildPanelModel(onboarding(), {}, Object.assign({ demoLink: true }, CTX)));
    assert.ok(withLink.includes(link));
    assert.equal(countAccent(withLink), 0);
    assert.doesNotMatch(withLink, /[!¡]/);
    assert.ok(!I.renderPanel(I.buildPanelModel(onboarding(), {}, CTX)).includes('data-assist-act="demo"'), 'por defecto no');
    assert.ok(!I.renderPanel(I.buildPanelModel(onboarding(), {}, { demoLink: true, confirmExit: true })).includes('data-assist-act="demo"'), 'no compite con la confirmación de salida');
});

/* ------------------------- sandbox con DOM falso ------------------------- */
// Alcanza para montar el dock, hacer clicks por data-assist-act y abrir la
// bienvenida. querySelector de un elemento devuelve un stub memorizado por
// selector (se limpia al asignar innerHTML); los timers son manuales.

class FakeCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
}
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
const IDENTITY = { userId: 'u-1' };

function fakeStorage(init) {
    const map = new Map(Object.entries(init || {}));
    return {
        get length() { return map.size; },
        key(i) { const keys = Array.from(map.keys()); return i < keys.length ? keys[i] : null; },
        getItem(k) { return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { map.set(k, String(v)); },
        removeItem(k) { map.delete(k); },
    };
}
function fakeClassList() {
    const set = new Set();
    return {
        add(...c) { c.forEach((x) => set.add(x)); },
        remove(...c) { c.forEach((x) => set.delete(x)); },
        contains(c) { return set.has(c); },
        toggle(c, force) { const on = force === undefined ? !set.has(c) : !!force; if (on) set.add(c); else set.delete(c); return on; },
    };
}
function fakeElement(tag, doc) {
    return {
        tagName: String(tag).toUpperCase(), className: '', id: '', textContent: '', hidden: false, offsetWidth: 0,
        style: {}, attributes: {}, children: [], parentNode: null, listeners: {}, queried: {}, _html: '',
        classList: fakeClassList(),
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = String(v); this.queried = {}; },
        get isConnected() { for (let n = this; n; n = n.parentNode) if (n === doc.body) return true; return false; },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
        removeAttribute(k) { delete this.attributes[k]; },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); },
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
        removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; return child; },
        querySelector(sel) {
            if (!this.queried[sel]) { const s = fakeElement('stub', doc); s.parentNode = this; this.queried[sel] = s; }
            return this.queried[sel];
        },
        querySelectorAll() { return []; },
        closest() { return null; },
        contains(other) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; },
        matches() { return false; },
        focus() { doc.activeElement = this; },
        getClientRects() { return [1]; },
        getBoundingClientRect() { return { top: 120, left: 80, width: 240, height: 48, right: 320, bottom: 168 }; },
        scrollIntoView() {},
    };
}
function fakeDocument() {
    const listeners = {};
    const doc = {
        readyState: 'complete', activeElement: null, listeners, query: {}, ids: {},
        createElement: (tag) => fakeElement(tag, doc),
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
        dispatchEvent(ev) { (listeners[ev.type] || []).slice().forEach((fn) => fn(ev)); return true; },
        querySelector: (sel) => (doc.query[sel] || [])[0] || null,
        querySelectorAll: (sel) => doc.query[sel] || [],
        getElementById: (id) => doc.ids[id] || null,
    };
    doc.documentElement = fakeElement('html', doc);
    doc.head = fakeElement('head', doc);
    doc.body = fakeElement('body', doc);
    return doc;
}

// opts: pathname, server (estado del GET/POST), suggest, session, narrator ({ voice, failWith }), demo (pisa WoDemo).
function mountHarness(opts = {}) {
    const doc = fakeDocument();
    if (opts.readyState) doc.readyState = opts.readyState;
    const timers = new Map();
    let timerId = 0;
    const pathname = opts.pathname || '/artist/dashboard';
    const calls = { onboarding: [], api: [], enable: [], stopAssist: 0 };
    const h = { doc, calls, server: opts.server || onboarding(), suggest: opts.suggest !== undefined ? opts.suggest : true, onboardingImpl: null };
    const win = {
        location: { pathname, hash: '', search: '', href: 'https://beta.weotzi.com' + pathname },
        document: doc, innerWidth: opts.innerWidth || 1280,
        sessionStorage: fakeStorage(opts.session), localStorage: fakeStorage(opts.local),
        CustomEvent: FakeCustomEvent, console: { warn() {}, log() {}, error() {}, debug() {} },
        setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms: ms || 0 }); return timerId; },
        clearTimeout: (id) => { timers.delete(id); },
        setInterval: () => 0, clearInterval() {},
        addEventListener() {}, removeEventListener() {},
        getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
        matchMedia: () => ({ matches: false }),
    };
    win.window = win;
    win.WoDemo = Object.assign({
        enabled: false,
        identity: IDENTITY,
        onboarding(o) { calls.onboarding.push(o ? plain(o) : null); return h.onboardingImpl ? h.onboardingImpl(o) : Promise.resolve(h.server); },
        api(p, init) { calls.api.push({ path: p, method: init.method, body: plain(init.body) }); return Promise.resolve(h.server); },
        stopAssist() { calls.stopAssist += 1; return Promise.resolve(null); },
        enable(o) { calls.enable.push(plain(o)); },
        suggestionsEnabled() { return h.suggest; },
        appPath: (p) => p,
    }, opts.demo || {});
    if (opts.narrator) {
        const n = {
            voice: opts.narrator.voice !== false, speaks: [], toggles: [], done: null,
            RATES: [1, 1.25, 1.5], supported: () => true,
            voiceEnabled() { return n.voice; },
            setVoiceEnabled(on) { n.toggles.push(!!on); n.voice = !!on; return n.voice; },
            speak(text, done) {
                n.speaks.push({ text, voice: n.voice });
                n.done = done;
                const reason = opts.narrator.failWith || (!n.voice ? 'off' : null);
                if (reason) { win.setTimeout(() => done(false, reason), 0); return false; }
                return true;
            },
            stop() {}, getRate: () => 1, setRate() {}, formatRate: (r) => String(r) + '×',
        };
        win.WoTour = { narrator: n };
        h.narrator = n;
    }
    vm.createContext(win);
    vm.runInContext(jsSource, win, { filename: 'wo-assist.js' });
    Object.assign(h, {
        win, api: win.WoAssist,
        root: () => doc.body.children.find((c) => c.className === 'wo-assist') || null,
        ring: () => doc.body.children.find((c) => c.className === 'wo-assist-ring') || null,
        welcome: () => doc.body.children.find((c) => c.className === 'wo-assist-welcome') || null,
        panelHtml() { const r = h.root(); return r ? r.querySelector('.wo-assist__panel').innerHTML : ''; },
        live() { return h.root().querySelector('.wo-assist__live').textContent; },
        // Click real del dock: onRootClick resuelve el botón por closest('[data-assist-act]').
        click(act, attrs = {}) {
            const r = h.root();
            assert.ok(r, 'el dock está montado para ' + act);
            const btn = { parentNode: r.querySelector('.wo-assist__panel'), getAttribute: (k) => (k === 'data-assist-act' ? act : (attrs[k] === undefined ? null : attrs[k])) };
            btn.closest = () => btn;
            (r.listeners.click || []).forEach((fn) => fn({ target: btn }));
        },
        key(key) { doc.dispatchEvent({ type: 'keydown', key, shiftKey: false, preventDefault() {}, stopPropagation() {} }); },
        async flush() {
            for (let round = 0; round < 10; round++) {
                await settle();
                const due = Array.from(timers.entries()).sort((a, b) => a[1].ms - b[1].ms);
                timers.clear();
                if (!due.length) break;
                due.forEach(([, t]) => t.fn());
            }
            await settle();
        },
    });
    return h;
}
function inactive() { const d = onboarding(); d.onboarding.assisted.active = false; return d; }
function allDone() { return onboarding(Object.fromEntries(CONTRACT_STEPS.map((id) => [id, 'done']))); }

/* ------------------------------ comportamiento ------------------------------ */

test('dashboard: el dock ofrece "Probá el modo demo →" (abre el demo con recorrido) y se va si la sugerencia se apaga', async () => {
    const h = mountHarness();
    assert.equal(await h.api.boot({ start: true, identity: IDENTITY }), true);
    assert.match(h.panelHtml(), /data-assist-act="demo">Probá el modo demo →<\/button>/);
    h.click('demo');
    assert.deepEqual(h.calls.enable, [{ tour: true }], 'WoDemo.enable({ tour: true })');
    h.doc.dispatchEvent(new FakeCustomEvent('wo:demo-suggestions-changed', { detail: { enabled: false } }));
    assert.doesNotMatch(h.panelHtml(), /data-assist-act="demo"/, 'el switch del menú Ö lo saca en vivo');
    h.doc.dispatchEvent(new FakeCustomEvent('wo:demo-suggestions-changed', { detail: { enabled: true } }));
    assert.match(h.panelHtml(), /data-assist-act="demo"/, 'y vuelve si se prende');
    // "AHORA NO" en la tarjeta (sessionStorage) lo oculta en el próximo render.
    h.win.sessionStorage.setItem('wo_demo_suggest_dismissed', '1');
    h.doc.dispatchEvent(new FakeCustomEvent('wo:demo-suggestions-changed', { detail: { enabled: true } }));
    assert.doesNotMatch(h.panelHtml(), /data-assist-act="demo"/);
    h.api.close();
});

test('fuera del dashboard, con la sugerencia apagada o descartada en la sesión, el dock no ofrece el demo', async () => {
    const cases = [
        ['centro de cuenta', { pathname: '/artist/account' }],
        ['sugerencia apagada', { suggest: false }],
        ['AHORA NO en esta sesión', { session: { wo_demo_suggest_dismissed: '1' } }],
        ['WoDemo sin enable', { demo: { enable: undefined } }],
    ];
    for (const [name, opts] of cases) {
        const h = mountHarness(opts);
        await h.api.boot({ start: true, identity: IDENTITY });
        assert.equal(h.api.isActive(), true, name);
        assert.doesNotMatch(h.panelHtml(), /data-assist-act="demo"/, name);
        h.api.close();
    }
    const beta = mountHarness({ pathname: '/beta/artist/dashboard/' });
    await beta.api.boot({ start: true, identity: IDENTITY });
    assert.match(beta.panelHtml(), /data-assist-act="demo"/, 'con base path y barra final sigue siendo el dashboard');
    beta.api.close();
});

test('ESCUCHAR con la voz apagada en el recorrido la vuelve a prender antes de leer', async () => {
    const h = mountHarness({ narrator: { voice: false } });
    await h.api.boot({ start: true, identity: IDENTITY });
    h.click('listen');
    assert.deepEqual(h.narrator.toggles, [true], 'setVoiceEnabled(true) por el toque explícito');
    assert.equal(h.narrator.speaks.length, 1);
    assert.equal(h.narrator.speaks[0].voice, true, 'speak corre con la voz ya prendida');
    assert.match(h.narrator.speaks[0].text, /^Completá tu perfil\./);
    h.narrator.done(true, 'end');
    await h.flush();
    assert.equal(h.live(), '', 'si sonó, no hay aviso');
    h.click('listen');
    assert.deepEqual(h.narrator.toggles, [true], 'con la voz prendida no toca la preferencia');
    h.api.close();
});

test('ESCUCHAR que no arranca avisa el motivo en la región viva; cortarlo a mano no avisa nada', async () => {
    const cases = [
        ['unsupported', 'Este navegador no tiene voz para leer los pasos.'],
        ['gesture', 'Tocá de nuevo para escuchar: el navegador pide un toque antes de habilitar la voz.'],
        ['error', 'No pudimos leer el paso en voz alta. Probá de nuevo.'],
        ['off', 'No pudimos leer el paso en voz alta. Probá de nuevo.'],
        ['stopped', ''],
    ];
    for (const [reason, message] of cases) {
        const h = mountHarness({ narrator: { voice: true, failWith: reason } });
        await h.api.boot({ start: true, identity: IDENTITY });
        h.click('listen');
        await h.flush();
        assert.equal(h.live(), message, reason);
        assert.doesNotMatch(message, /[!¡]/);
        assert.match(h.panelHtml(), /<span>ESCUCHAR<\/span>/, reason + ': el botón vuelve a ESCUCHAR');
        h.api.close();
    }
});

test('arranque explícito: protege del GET viejo hasta que el servidor confirma; después active:false cierra', async () => {
    const h = mountHarness({ server: inactive() });
    await h.api.boot({ start: true, identity: IDENTITY });
    assert.equal(h.api.isActive(), true, 'antes de confirmar, un active:false viejo no cierra');
    h.server = onboarding();
    await h.api.refresh();
    assert.equal(h.api.isActive(), true, 'el servidor confirma active:true');
    h.server = inactive();
    await h.api.refresh();
    assert.equal(h.api.isActive(), false, 'salió en otra pestaña: el panel se cierra');
    assert.equal(h.root(), null);
    // Lo mismo por el evento que disparan las páginas al guardar.
    const e = mountHarness();
    await e.api.boot({ start: true, identity: IDENTITY });
    e.server = inactive();
    e.doc.dispatchEvent(new FakeCustomEvent('wo:assist-refresh'));
    await e.flush();
    assert.equal(e.api.isActive(), false, 'wo:assist-refresh con active:false también cierra');
});

test('salir mientras carga el primer estado: cuando la respuesta llega, el panel no vuelve', async () => {
    const h = mountHarness();
    let release = null;
    h.onboardingImpl = () => new Promise((resolve) => { release = resolve; });
    const booting = h.api.boot({ start: true, identity: IDENTITY });
    await settle();
    assert.equal(h.api.isActive(), true, 'el arranque explícito muestra el panel cargando');
    assert.match(h.panelHtml(), /Cargando tus pasos/);
    h.click('close');
    h.click('exit-confirm');
    assert.equal(h.api.isActive(), false);
    assert.equal(h.calls.stopAssist, 1);
    release(onboarding()); // pedido antes de salir: todavía dice active:true
    assert.equal(await booting, false);
    await h.flush();
    assert.equal(h.api.isActive(), false, 'el boot viejo no vuelve a montar el panel');
    assert.equal(h.root(), null);
    // Volver a abrirlo después funciona: no queda colgado del arranque anterior.
    h.onboardingImpl = null;
    assert.equal(await h.api.open(), true);
    assert.equal(h.api.isActive(), true);
    h.api.close();
});

test('salir antes de DOMContentLoaded: el arranque pendiente no monta nada al terminar de cargar la página', async () => {
    const h = mountHarness({ readyState: 'loading' });
    const booting = h.api.boot({ start: true, identity: IDENTITY });
    await settle();
    assert.equal(h.api.isActive(), false, 'todavía esperando el DOM');
    h.api.close();
    h.doc.readyState = 'interactive';
    h.doc.dispatchEvent({ type: 'DOMContentLoaded' });
    assert.equal(await booting, false);
    await h.flush();
    assert.equal(h.api.isActive(), false);
    assert.equal(h.root(), null);
    assert.equal(h.calls.onboarding.length, 0, 'ni siquiera pide el estado');
});

test('cerrar y reabrir antes de que llegue el primer estado arranca de cero', async () => {
    const h = mountHarness();
    const pending = [];
    h.onboardingImpl = () => new Promise((resolve) => { pending.push(resolve); });
    const first = h.api.boot({ start: true, identity: IDENTITY });
    await settle();
    h.api.close();
    const second = h.api.open();
    assert.notEqual(second, first, 'open() no devuelve el arranque descartado');
    await settle();
    assert.equal(pending.length, 2);
    pending[0](onboarding());
    assert.equal(await first, false);
    assert.equal(h.api.isActive(), true, 'el panel nuevo sigue montado');
    pending[1](onboarding());
    assert.equal(await second, true);
    assert.equal(h.api.isActive(), true);
    h.api.close();
});

test('CONTINUAR → apaga el marco que había quedado en el campo del paso anterior', async () => {
    const h = mountHarness({ pathname: '/artist/account', server: onboarding({ perfil: 'done' }) });
    const section = h.doc.createElement('section');
    const anchor = h.doc.createElement('div');
    h.doc.body.appendChild(section);
    section.appendChild(anchor);
    h.doc.ids['aac-perfil'] = section;
    h.doc.query['[data-assist~="perfil"]'] = [anchor];
    await h.api.boot({ start: true, identity: IDENTITY });
    h.click('pick-step', { 'data-step': 'perfil' });
    assert.equal(h.api.state().step, 'perfil');
    h.click('go');
    await h.flush();
    assert.ok(h.ring(), 'IR AL PASO → arma el marco');
    assert.equal(h.ring().hidden, false, 'el marco está sobre el campo');
    h.click('continue');
    assert.equal(h.ring().hidden, true, 'CONTINUAR → lo apaga antes de cambiar de paso');
    assert.notEqual(h.api.state().step, 'perfil');
    h.api.close();
});

test('"Ya lo revisé" manda el acknowledge del paso y relee el estado', async () => {
    const statuses = Object.fromEntries(CONTRACT_STEPS.map((id) => [id, 'done']));
    statuses.configuracion = 'pending';
    const h = mountHarness({ server: onboarding(statuses) });
    await h.api.boot({ start: true, identity: IDENTITY });
    assert.equal(h.api.state().step, 'configuracion');
    assert.match(h.panelHtml(), /data-assist-act="reviewed">Ya lo revisé</);
    const before = h.calls.onboarding.length;
    h.click('reviewed');
    await h.flush();
    assert.deepEqual(h.calls.api.filter((c) => c.method === 'POST').map((c) => c.body), [{ assisted: { acknowledge: 'configuracion' } }]);
    assert.deepEqual(h.calls.onboarding.slice(before), [{ fresh: true }], 'refresh después del POST');
    h.api.close();
    // Notificaciones manda su propio id.
    const statusesN = Object.fromEntries(CONTRACT_STEPS.map((id) => [id, 'done']));
    statusesN.notificaciones = 'pending';
    const n = mountHarness({ server: onboarding(statusesN) });
    await n.api.boot({ start: true, identity: IDENTITY });
    assert.equal(n.api.state().step, 'notificaciones');
    n.click('reviewed');
    await n.flush();
    assert.deepEqual(n.calls.api.filter((c) => c.method === 'POST').map((c) => c.body), [{ assisted: { acknowledge: 'notificaciones' } }]);
    n.api.close();
});

test('el handler de "Ya lo revisé" solo acepta notificaciones y configuración', async () => {
    const h = mountHarness();
    await h.api.boot({ start: true, identity: IDENTITY });
    assert.equal(h.api.state().step, 'perfil');
    h.click('reviewed');
    await h.flush();
    assert.equal(h.calls.api.filter((c) => c.method === 'POST').length, 0, 'perfil no se puede dar por revisado');
    h.api.close();
});

test('al montar, el panel emite wo:assist-changed { active: true } una vez y su propio listener no entra en loop', async () => {
    const h = mountHarness();
    const events = [];
    h.doc.addEventListener('wo:assist-changed', (e) => events.push(plain(e.detail)));
    await h.api.boot({ identity: IDENTITY });
    assert.equal(h.api.isActive(), true, 'el servidor dice active:true y el panel se monta con datos');
    assert.deepEqual(events, [{ active: true }], 'el menú Ö se entera cuando isActive() ya es true');
    h.doc.dispatchEvent(new FakeCustomEvent('wo:assist-changed', { detail: { active: true } }));
    assert.equal(events.length, 2, 'un active:true ajeno no re-emite');
    assert.equal(h.api.isActive(), true);
    h.doc.dispatchEvent(new FakeCustomEvent('wo:assist-changed', { detail: { active: false } }));
    assert.equal(h.api.isActive(), false, 'active:false desmonta');
    assert.equal(events.length, 3, 'close() no re-emite');
});

test('Esc cierra la bienvenida aunque el foco haya quedado en <body>, y el listener se va al cerrar', async () => {
    const h = mountHarness({ server: allDone() });
    await h.api.boot({ identity: IDENTITY });
    await h.flush();
    assert.equal(h.api.state().welcomeOpen, true, 'todo completo y sin welcome_seen_at: abre la bienvenida');
    assert.equal((h.doc.listeners.keydown || []).length, 1, 'Esc se escucha en el documento');
    h.doc.activeElement = h.doc.body; // click en el texto de la bienvenida
    h.key('Escape');
    assert.equal(h.api.state().welcomeOpen, false);
    assert.equal(h.welcome(), null);
    assert.equal(h.api.isActive(), false, 'cerrar la bienvenida termina el modo asistido');
    assert.equal(h.calls.stopAssist, 1);
    assert.equal((h.doc.listeners.keydown || []).length, 0, 'sin listeners colgados después de cerrar');
    h.key('Escape');
    assert.equal(h.calls.stopAssist, 1, 'un Esc posterior no hace nada');
});

test('con la bienvenida abierta, los avisos de voz van a la región viva del diálogo (el dock queda inert)', async () => {
    const h = mountHarness({ server: allDone(), narrator: { voice: true, failWith: 'unsupported' } });
    await h.api.boot({ identity: IDENTITY });
    await h.flush();
    const host = h.welcome();
    assert.ok(host, 'bienvenida abierta');
    assert.match(host.innerHTML, /<p class="wo-assist__sr wo-assist-welcome__live" role="status" aria-live="polite"><\/p>/);
    assert.equal(h.root().getAttribute('inert'), '');
    (host.listeners.click || []).forEach((fn) => fn({ target: { closest: () => ({ getAttribute: () => 'listen' }) }, preventDefault() {} }));
    await h.flush();
    assert.equal(host.querySelector('.wo-assist-welcome__live').textContent, 'Este navegador no tiene voz para leer los pasos.');
    h.key('Escape');
});
