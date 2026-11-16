'use strict';

// Español neutro en tiempo de ejecución (public/shared/js/neutral-es.js).
// Las funciones de la base ya aplicadas levantan mensajes en voseo y esas
// migraciones no se editan: el módulo los pasa a tuteo antes de mostrarlos.
//   1. el neutralizador: diccionario, mayúsculas, idempotencia, "seña" →
//      "anticipo" con concordancia, "vos" por contexto, lo que NO se toca;
//   2. propiedad: ningún "raise exception" de supabase/migrations conserva una
//      forma del diccionario después de neutralize();
//   3. un test por punto de enganche: lib/postgrest.js, rpcAsCaller, los mapeos
//      del servidor, WeotziData.run, el cargador de config-manager.js, los
//      helpers de aviso y los mapeos de error del navegador (regex bilingües).
// El enganche de wo-notify.js se prueba en tests/r2-push-front.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key';

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const shared = (file) => read('public', 'shared', 'js', ...file.split('/'));
const N = require('../public/shared/js/neutral-es.js');
const n = N.neutralize;

function each(cases) {
    for (const [input, expected] of Object.entries(cases)) assert.equal(n(input), expected, input);
}

// ---------------------------------------------------------------- 1 · neutralizador

test('diccionario: imperativos, presentes y enclíticos del voseo pasan a tuteo', () => {
    each({
        'Iniciá sesión.': 'Inicia sesión.',
        'No tenés acceso a este estudio': 'No tienes acceso a este estudio',
        'Solo podés retirar tu propuesta.': 'Solo puedes retirar tu propuesta.',
        'Elegí el medio de pago.': 'Elige el medio de pago.',
        'No encontramos el comprobante. Subilo de nuevo.': 'No encontramos el comprobante. Súbelo de nuevo.',
        'Contanos cómo podemos verificar el estudio (mínimo 10 caracteres).': 'Cuéntanos cómo podemos verificar el estudio (mínimo 10 caracteres).',
        'Este link de alta venció. Pedile al tatuador que genere uno nuevo.': 'Este link de alta venció. Pídele al tatuador que genere uno nuevo.',
        'Elegí si actualizás la invitación o mantenés las condiciones.': 'Elige si actualizas la invitación o mantienes las condiciones.',
        'No encontramos uno de los archivos. Volvé a subirlo.': 'No encontramos uno de los archivos. Vuelve a subirlo.',
        'Generaste muchos enlaces hoy. Probá de nuevo mañana.': 'Generaste muchos enlaces hoy. Prueba de nuevo mañana.',
        '¿Sos el dueño? Acá lo ves.': '¿Eres el dueño? Aquí lo ves.',
        // Formas que solo levanta la base (no estaban en el código).
        'Ese estudio ya está en We Ötzi: reclamalo desde el registro.': 'Ese estudio ya está en We Ötzi: reclámalo desde el registro.',
        '2 sesión(es) futura(s). Realizalas o cancelalas.': '2 sesión(es) futura(s). Realízalas o cancélalas.',
        'Saldo disponible: ARS 100. Retiralo antes de la baja.': 'Saldo disponible: ARS 100. Retíralo antes de la baja.',
        '3 artista(s) con membresía activa. Finalizá las membresías primero.': '3 artista(s) con membresía activa. Finaliza las membresías primero.'
    });
    assert.ok(Object.keys(N.DICT).length > 400, 'el diccionario viaja embebido');
    assert.ok(Object.isFrozen(N.DICT));
});

test('conserva las mayúsculas del original', () => {
    each({
        'INICIÁ SESIÓN PARA SEGUIR': 'INICIA SESIÓN PARA SEGUIR',
        'Revisá el impuesto y la moneda': 'Revisa el impuesto y la moneda',
        'si es otro, elegí un nombre': 'si es otro, elige un nombre',
        'ELEGÍ TU ESTILO': 'ELIGE TU ESTILO',
        'SEÑAS RECIBIDAS': 'ANTICIPOS RECIBIDOS',
        'PARA VOS': 'PARA TI',
        'Acá tenés tu resumen': 'Aquí tienes tu resumen'
    });
});

test('"seña" pasa a "anticipo" y concuerdan determinante, adjetivos y participios', () => {
    each({
        'Pago de la seña': 'Pago del anticipo',
        'Falta una seña': 'Falta un anticipo',
        'A la seña le falta el comprobante': 'Al anticipo le falta el comprobante',
        'toda la seña': 'todo el anticipo',
        'Seña pagada': 'Anticipo pagado',
        'SEÑA REQUERIDA': 'ANTICIPO REQUERIDO',
        'Seña mínima requerida': 'Anticipo mínimo requerido',
        'La seña no está confirmada': 'El anticipo no está confirmado',
        'la seña todavía no fue acreditada': 'el anticipo todavía no fue acreditado',
        'La seña requerida ya fue pagada. Pagala por los medios del artista.': 'El anticipo requerido ya fue pagado. Págalo por los medios del artista.',
        'La seña fue retenida': 'El anticipo fue retenido',
        'Las señas fueron liberadas': 'Los anticipos fueron liberados',
        'la misma seña': 'el mismo anticipo',
        'la primera seña': 'el primer anticipo',
        'Cobrá señas y pagos protegidos': 'Cobra anticipos y pagos protegidos',
        'Sin seña': 'Sin anticipo',
        'seña pendiente': 'anticipo pendiente',
        // No son participios ni adjetivos de "seña".
        'la seña no es nada': 'el anticipo no es nada',
        'una seña cada sesión': 'un anticipo cada sesión',
        'La seña valida tu reserva': 'El anticipo valida tu reserva'
    });
    // Otras palabras que contienen "seña" quedan como están.
    for (const same of ['reseña', 'Reseñas recibidas', 'diseñar', 'señal', 'Lengua de señas', 'contraseña']) assert.equal(n(same), same);
});

test('"vos" se resuelve por contexto: contigo, preposición + ti, tú', () => {
    each({
        'Hablá con vos mismo': 'Habla contigo mismo',
        'Con vos': 'Contigo',
        'Para vos': 'Para ti',
        'Cerca de vos': 'Cerca de ti',
        'frente a vos': 'frente a ti',
        'Solo vos podés verlo': 'Solo tú puedes verlo',
        'antes que vos': 'antes que tú',
        'Vos': 'Tú',
        'Vos, o Google': 'Tú, o Google',
        'decimos "vos" o "usuario"': 'decimos "tú" o "usuario"',
        'cerca tuyo': 'cerca de ti',
        'CERCA TUYO': 'CERCA DE TI'
    });
    for (const same of ['vosotros', 'nuevos', 'devos']) assert.equal(n(same), same);
});

test('es idempotente y devuelve intacto lo que no es string', () => {
    const samples = [
        'La seña requerida ya fue pagada. Pagala por los medios del artista.',
        'Tatuate con vos, cerca tuyo: elegí, subí y confirmá.',
        'Ya hay un estudio llamado «Acá Tattoo» en We Ötzi. Elegí un nombre que lo distinga (por ejemplo, sumá el barrio o la ciudad).',
        'Ya subí el comprobante', 'INICIÁ SESIÓN', 'JWT expired', ''
    ];
    for (const s of samples) assert.equal(n(n(s)), n(s), s);
    const obj = { message: 'Iniciá sesión' };
    assert.equal(n(obj), obj);
    assert.equal(n(null), null);
    assert.equal(n(undefined), undefined);
    assert.equal(n(42), 42);
    assert.equal(n(''), '');
    // Sin nada que cambiar devuelve el mismo string.
    assert.equal(n('Todo listo: tu perfil ya está publicado.'), 'Todo listo: tu perfil ya está publicado.');
});

test('no toca texto en inglés ni identificadores', () => {
    const same = [
        'JWT expired',
        'duplicate key value violates unique constraint "quotations_pkey"',
        'new row violates row-level security policy for table "quotations_db"',
        'Could not find the function public.sos_x(p_id) in the schema cache',
        'permission denied for table artists_db',
        'invalid input syntax for type uuid: "abc"',
        'store:out_of_stock',
        'sos_token', 'seña2', 'seña_total',
        'artistas-para-vos',
        'Enviamos el enlace a vos@email.com',
        'https://weotzi.com/registrate',
        '#sos', 'sos.tattoo',
        'La variable {{seña}} no existe',
        'La clave "seña" no existe',
        'usa', 'OK'
    ];
    for (const s of same) assert.equal(n(s), s, s);
    // El texto alrededor sí cambia; la dirección y la ruta no.
    assert.equal(n('Escribinos a sos@weotzi.com o registrate en https://weotzi.com/registrate'),
        'Escríbenos a sos@weotzi.com o regístrate en https://weotzi.com/registrate');
    assert.equal(n('<span>Elegí un artista</span> <a href="/artist/registrate">Registrate</a>'),
        '<span>Elige un artista</span> <a href="/artist/registrate">Regístrate</a>');
});

test('respeta nombres propios, valores entre «» y pretéritos en primera persona', () => {
    // Valor citado por la base: el nombre del estudio no se traduce.
    assert.equal(n('Ya hay un estudio llamado «Acá Tattoo» en We Ötzi. Elegí un nombre que lo distinga (por ejemplo, sumá el barrio o la ciudad).'),
        'Ya hay un estudio llamado «Acá Tattoo» en We Ötzi. Elige un nombre que lo distinga (por ejemplo, suma el barrio o la ciudad).');
    // Nombres propios: mayúscula en medio de la oración, o seguida de otra palabra en mayúscula.
    for (const same of ['Acá Tattoo te invitó a su roster', 'Invitación enviada a Vení Tattoo', 'Tatuaje con Vos Ink']) assert.equal(n(same), same, same);
    assert.equal(n('Mirá, Acá Tattoo'), 'Mira, Acá Tattoo');
    // Pretéritos puestos en boca del usuario: no son voseo.
    for (const same of ['Ya subí el comprobante', 'Te escribí ayer', 'No lo elegí', 'Esta vez elegí a otro artista. Gracias.', 'Hola, subí los documentos de verificación. ¿Cuánto tarda la revisión?']) {
        assert.equal(n(same), same, same);
    }
    // El imperativo voseante con la misma forma sí cambia.
    each({ 'Subí tu documento': 'Sube tu documento', 'Atención: Elegí el medio de pago.': 'Atención: Elige el medio de pago.', '(Elegí una)': '(Elige una)', 'Elegí\nSubí tu foto': 'Elige\nSube tu foto' });
});

test('error() y errorBody() neutralizan message, details y hint y nada más', () => {
    const err = new Error('Solo podés retirar tu propuesta.');
    err.details = 'Elegí otra propuesta';
    err.hint = null;
    err.code = 'P0001';
    assert.equal(N.error(err), err);
    assert.deepEqual([err.message, err.details, err.hint, err.code], ['Solo puedes retirar tu propuesta.', 'Elige otra propuesta', null, 'P0001']);
    assert.equal(N.error(null), null);
    assert.equal(N.error('Iniciá sesión'), 'Iniciá sesión', 'un string no es un error: no lo toca');

    const body = '{"code":"P0001","details":null,"hint":"Probá de nuevo","message":"No tenés acceso\\nRevisá tu sesión"}';
    assert.deepEqual(JSON.parse(N.errorBody(body)), { code: 'P0001', details: null, hint: 'Prueba de nuevo', message: 'No tienes acceso\nRevisa tu sesión' });
    const english = '{"code":"42501","details":null,"hint":null,"message":"permission denied for table x"}';
    assert.equal(N.errorBody(english), english, 'sin voseo devuelve el mismo cuerpo, byte por byte');
    assert.equal(N.errorBody('<html>502 Bad Gateway</html>'), '<html>502 Bad Gateway</html>');
    assert.equal(N.errorBody('No podés hacer eso'), 'No puedes hacer eso', 'texto plano');
    assert.equal(N.errorBody('{no es json: revisá'), '{no es json: revisa');
    assert.equal(N.errorBody(''), '');
    assert.equal(N.errorBody(undefined), undefined);
});

test('el módulo es UMD, sin dependencias y sin lookbehind (navegadores viejos)', () => {
    const src = shared('neutral-es.js');
    assert.doesNotMatch(src, /\(\?<[!=]/, 'sin lookbehind');
    assert.doesNotMatch(src, /require\(|import /);
    const window = {};
    vm.runInNewContext(src, { window });
    assert.equal(typeof window.WoNeutralEs.neutralize, 'function');
    assert.equal(window.WoNeutralEs.neutralize('Iniciá sesión.'), 'Inicia sesión.');
});

// ---------------------------------------------------------------- 2 · propiedad sobre el SQL

const RAISE_RE = /raise\s+exception\s+'((?:[^']|'')*)'/gi;
function raiseLiterals() {
    const dir = path.join(ROOT, 'supabase', 'migrations');
    const out = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        for (const match of sql.matchAll(RAISE_RE)) out.push({ file, text: match[1].replace(/''/g, "'") });
    }
    return out;
}
// Detector independiente del módulo: palabra por palabra contra el diccionario, más "seña" y "vos".
function voseoForms(text) {
    return (text.match(/\p{L}+/gu) || []).filter((word) => {
        const key = word.toLowerCase();
        return N.DICT[key] !== undefined || key === 'seña' || key === 'señas' || key === 'vos';
    });
}

test('propiedad: ningún "raise exception" de supabase/migrations conserva voseo tras neutralize()', () => {
    const literals = raiseLiterals();
    assert.ok(literals.length > 500, `se leyeron ${literals.length} raise exception`);
    const voseo = literals.filter((l) => voseoForms(l.text).length > 0);
    assert.ok(voseo.length >= 90, `las migraciones aplicadas tienen ${voseo.length} mensajes en voseo`);
    for (const l of literals) {
        const out = n(l.text);
        assert.deepEqual(voseoForms(out), [], `${l.file}: "${l.text}" → "${out}"`);
        assert.equal(n(out), out, `idempotente: ${l.text}`);
        if (!voseoForms(l.text).length) assert.equal(out, l.text, `sin voseo no cambia: ${l.file}: ${l.text}`);
    }
});

// ---------------------------------------------------------------- 3a · servidor

function mockFetchError(status, body) {
    global.fetch = async () => ({ ok: false, status, headers: { get: () => null }, text: async () => body });
}

test('servidor · lib/postgrest.js arma el Error con el texto de la base en tuteo', async () => {
    const { pgrest } = require('../lib/postgrest');
    const original = global.fetch;
    try {
        mockFetchError(400, JSON.stringify({ code: 'P0001', details: null, hint: 'Probá de nuevo mañana.', message: 'No tenés permiso para administrar este estudio.' }));
        const check = (err) => {
            assert.equal(err.status, 400);
            assert.match(err.message, /"message":"No tienes permiso para administrar este estudio\."/);
            assert.match(err.message, /"hint":"Prueba de nuevo mañana\."/);
            assert.match(err.message, /"code":"P0001"/);
            assert.doesNotMatch(err.message, /tenés|Probá/);
            return true;
        };
        await assert.rejects(() => pgrest.raw('rpc/update_studio', { method: 'POST', body: {} }), check);
        await assert.rejects(() => pgrest('studios').eq('id', 1).patch({ name: 'x' }), check);

        // Un error en inglés llega tal cual, y la marca de FK se conserva.
        const english = '{"code":"23503","details":"Key (id)=(1) is still referenced","hint":null,"message":"update or delete on table \\"x\\" violates foreign key constraint"}';
        mockFetchError(409, english);
        await assert.rejects(() => pgrest('x').eq('id', 1).delete(), (err) => {
            assert.equal(err.status, 409);
            assert.equal(err.code, '23503');
            assert.ok(err.message.endsWith(english), 'cuerpo intacto');
            return true;
        });
    } finally {
        global.fetch = original;
    }
});

test('servidor · rpcAsCaller (reclamos de estudio) entrega dbMessage en tuteo', async () => {
    const claims = require('../lib/repos/studio-claims');
    const fetchImpl = async () => ({ ok: false, status: 400, text: async () => '{"code":"22023","details":null,"hint":null,"message":"Contale al estudio por qué no aprobamos la verificación."}' });
    await assert.rejects(() => claims.rpcAsCaller('decide_studio_claim', {}, 'jwt-de-soporte', { fetchImpl }), (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, '22023');
        assert.equal(err.dbMessage, 'Cuéntale al estudio por qué no aprobamos la verificación.');
        assert.doesNotMatch(err.message, /Contale/);
        return true;
    });
});

test('servidor · los mapeos de error reconocen voseo y tuteo y responden en tuteo', () => {
    const routes = require('../lib/routes/roster');
    const rpc = (message) => new Error('PostgREST POST rpc/x failed (400): ' + JSON.stringify({ code: '22023', details: null, hint: null, message }));
    assert.equal(routes.rpcErrorMessage(rpc('Generaste muchos enlaces hoy. Probá de nuevo mañana.'), 'x'), 'Generaste muchos enlaces hoy. Prueba de nuevo mañana.');
    assert.equal(routes.rpcErrorMessage(rpc('Elegí otro rol'), 'x'), 'Elige otro rol');
    assert.equal(routes.rpcErrorMessage(rpc('Elige otro rol'), 'x'), 'Elige otro rol', 'sin tildes: lo reconoce por la forma en tuteo');
    assert.equal(routes.rpcErrorMessage(rpc('Prueba de nuevo'), 'x'), 'Prueba de nuevo');
    assert.equal(routes.rpcErrorMessage(rpc('relation foo does not exist'), 'genérico'), 'genérico');

    const Verif = require('../lib/verificacion-artista');
    const verif = (message) => new Error('PostgREST POST rpc/request_artist_verification failed (400): ' + JSON.stringify({ code: 'P0001', details: null, hint: null, message }));
    assert.deepEqual(Verif.mapRpcError(verif('No podés solicitar la verificación en este momento.')), { status: 409, error: 'No puedes solicitar la verificación en este momento.' });
    assert.deepEqual(Verif.mapRpcError(verif('No puedes solicitar la verificación en este momento.')), { status: 409, error: 'No puedes solicitar la verificación en este momento.' });
    assert.deepEqual(Verif.mapRpcError(verif('Antes de solicitarla, subí tu comprobante de domicilio.')), { status: 409, error: 'Antes de solicitarla, sube tu comprobante de domicilio.' });
});

// ---------------------------------------------------------------- 3b · navegador: capa de datos

function loadClient(extras) {
    const window = Object.assign({ _supabase: { marker: true } }, extras);
    vm.runInNewContext(shared('data/postgrest-client.js'), { window, console });
    return window;
}
const dbError = () => ({ code: 'P0001', message: 'Solo podés retirar tu propuesta.', details: 'Elegí otra propuesta', hint: 'Probá de nuevo' });

test('navegador · WeotziData.run pasa a tuteo el mensaje y su cause', async () => {
    const w = loadClient({ WoNeutralEs: N });
    await assert.rejects(() => w.WeotziData.run('Quotes.withdraw', async () => ({ data: null, error: dbError() })), (err) => {
        assert.equal(err.message, '[Quotes.withdraw] Solo puedes retirar tu propuesta.');
        assert.equal(err.code, 'P0001');
        assert.equal(err.cause.message, 'Solo puedes retirar tu propuesta.');
        assert.equal(err.cause.details, 'Elige otra propuesta');
        assert.equal(err.cause.hint, 'Prueba de nuevo');
        return true;
    });
    // Un error en inglés no cambia, y el camino feliz tampoco.
    await assert.rejects(() => w.WeotziData.run('X', async () => ({ data: null, error: { code: '42501', message: 'permission denied for table x' } })),
        (err) => err.message === '[X] permission denied for table x' && err.code === '42501');
    const ok = await w.WeotziData.run('X', async () => ({ data: [{ id: 1 }], error: null, count: 1 }));
    assert.equal(ok.count, 1);
    assert.equal(ok.data[0].id, 1);
});

test('navegador · sin neutral-es.js cargado WeotziData.run sigue funcionando', async () => {
    const w = loadClient({});
    await assert.rejects(() => w.WeotziData.run('Quotes.withdraw', async () => ({ data: null, error: dbError() })), (err) => {
        assert.equal(err.message, '[Quotes.withdraw] Solo podés retirar tu propuesta.');
        assert.equal(err.cause.details, 'Elegí otra propuesta');
        return true;
    });
    // Un módulo roto tampoco rompe la capa de datos.
    const broken = loadClient({ WoNeutralEs: { error() { throw new Error('boom'); } } });
    await assert.rejects(() => broken.WeotziData.run('X', async () => ({ data: null, error: dbError() })), /\[X\] Solo podés retirar tu propuesta\./);
});

test('navegador · config-manager.js carga neutral-es.js una sola vez desde /shared/', () => {
    const src = shared('config-manager.js');
    const start = src.indexOf('// Español neutro en tiempo de ejecución');
    assert.ok(start > 0, 'bloque del cargador');
    const block = src.slice(src.indexOf('(function () {', start), src.indexOf('})();', start) + 5);
    assert.ok(block.includes('neutral-es.js'));
    assert.ok(start < src.indexOf('// Avisos push / in-app'), 'se pide antes que wo-notify.js');

    function run(scriptSrc, window = {}) {
        const added = [];
        const document = {
            currentScript: scriptSrc ? { src: scriptSrc } : null,
            head: { appendChild: (el) => added.push(el) },
            createElement: (tag) => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } })
        };
        vm.runInNewContext(block, { window, document });
        return added;
    }
    const added = run('https://beta.weotzi.com/shared/js/config-manager.js?v=20261116');
    assert.equal(added.length, 1);
    assert.equal(added[0].tag, 'script');
    assert.equal(added[0].src, 'https://beta.weotzi.com/shared/js/neutral-es.js');
    assert.equal(added[0].async, false, 'conserva el orden de ejecución');
    assert.equal(run('https://x.example/beta/shared/js/config-manager.js')[0].src, 'https://x.example/beta/shared/js/neutral-es.js');
    assert.equal(run(null).length, 0, 'sin currentScript (tests, bundles) no hace nada');
    assert.equal(run('https://beta.weotzi.com/shared/js/config-manager.js', { WoNeutralEs: N }).length, 0, 'ya cargado');
    assert.equal(run('https://beta.weotzi.com/shared/js/config-manager.js', { __woNeutralEsLoader: true }).length, 0, 'ya pedido');
});

// ---------------------------------------------------------------- 3c · navegador: avisos

// Texto de una función declarada en un archivo, desde su encabezado hasta la llave que la cierra.
function functionSource(src, header) {
    const start = src.indexOf(header);
    assert.ok(start >= 0, 'no encuentro: ' + header);
    let depth = 0;
    for (let i = start + header.length - 1; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('función sin cerrar: ' + header);
}
function fakeEl() {
    return {
        children: [], hidden: true, dataset: {}, className: '', textContent: '', innerHTML: '',
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {}, removeAttribute() {}, addEventListener() {}, focus() {}, remove() {},
        appendChild(child) { this.children.push(child); return child; }
    };
}
// Corre el helper de aviso de un archivo con un DOM mínimo y devuelve lo que pintó.
function paint(file, header, name, args, neutral) {
    const target = fakeEl();
    const created = [];
    const timers = { setTimeout: () => 0, clearTimeout() {} };
    const window = Object.assign({}, timers, neutral ? { WoNeutralEs: N } : {});
    const document = {
        body: fakeEl(),
        getElementById: (id) => (id === 'jb-toast' ? null : target),
        createElement: () => { const el = fakeEl(); created.push(el); return el; }
    };
    const context = Object.assign({
        window, document, state: {}, toastTimeout: null, status: target,
        el: { 'calendar-toast': target }, $: () => target,
        esc: (s) => String(s), escapeHtml: (s) => String(s), requestAnimationFrame() {}
    }, timers);
    const fn = vm.runInNewContext(functionSource(shared(file), header) + '\n;' + name, context);
    fn(...args);
    return [target, ...created].map((el) => el.textContent + ' ' + el.innerHTML).join(' ');
}
const HELPERS = [
    ['admin.js', 'function showToast(message, type = \'info\') {', 'showToast', (m) => [m, 'error']],
    ['quotation-detail-figma.js', 'function showToast(message, opts = {}) {', 'showToast', (m) => [m, { error: true }]],
    ['calendar.js', 'function showToast(message, isError = false) {', 'showToast', (m) => [m, true]],
    ['job-board-feed.js', 'function showToast(message, type) {', 'showToast', (m) => [m, 'error']],
    ['studio-register.js', 'function showStatus(kind, message, field) {', 'showStatus', (m) => ['error', m]],
    ['studio-dashboard.js', 'function showStatus(elId, kind, msg) {', 'showStatus', (m) => ['team-status', 'error', m]],
    ['studio-login.js', 'function showStatus(kind, message, focus) {', 'showStatus', (m) => ['error', m]]
];

test('avisos · los helpers showToast/showStatus más usados pintan el mensaje de la base en tuteo', () => {
    const voseo = 'No tenés permiso para administrar este estudio.';
    const tuteo = 'No tienes permiso para administrar este estudio.';
    for (const [file, header, name, args] of HELPERS) {
        const withModule = paint(file, header, name, args(voseo), true);
        assert.ok(withModule.includes(tuteo), `${file}: pinta en tuteo`);
        assert.ok(!withModule.includes('tenés'), `${file}: sin voseo`);
        const without = paint(file, header, name, args(voseo), false);
        assert.ok(without.includes(voseo), `${file}: sin el módulo cargado muestra el texto como vino`);
        // El copy de la app (ya en tuteo) pasa sin cambios.
        assert.ok(paint(file, header, name, args('Guardamos los cambios.'), true).includes('Guardamos los cambios.'), file);
    }
});

// ---------------------------------------------------------------- 3d · mapeos de error del navegador

// Corre un módulo UMD del navegador con `window` (y neutral-es.js cargado o no) y devuelve sus exports.
function loadUmd(file, neutral = true) {
    const window = neutral ? { WoNeutralEs: N } : {};
    const module = { exports: {} };
    vm.runInNewContext(shared(file), { window, self: window, module, console });
    return module.exports;
}

test('mapeos · "Eliminar mi cuenta" reconoce voseo y tuteo y muestra los pendientes en tuteo', () => {
    const Widget = loadUmd('account-deletion.js')._internal;
    const cause = (message, code) => ({ message: '[AccountDeletion.request] ' + message, cause: { message, code } });
    assert.equal(Widget.errorText(cause('Ya tenés una solicitud de baja abierta.')), 'Ya tienes una solicitud de baja abierta.');
    assert.equal(Widget.errorText(cause('Ya tienes una solicitud de baja abierta.')), 'Ya tienes una solicitud de baja abierta.');
    assert.equal(Widget.errorText(cause('Iniciá sesión para pedir la baja.')), 'Inicia sesión para pedir la baja.');
    assert.equal(Widget.errorText(cause('Inicia sesion')), 'Inicia sesion', 'la forma en tuteo se reconoce aunque no traiga tildes');
    const html = Widget.blockerListHtml([
        { code: 'future_sessions', severity: 'block', label: 'Sesiones futuras', detail: '2 sesión(es) futura(s). Realizalas o cancelalas.' },
        { code: 'wallet_balance', severity: 'block', label: 'Saldo', detail: 'Saldo disponible: ARS 100. Retiralo antes de la baja.', href: '/artist/account#cobros' }
    ], 'vacío');
    assert.match(html, /Realízalas o cancélalas\./);
    assert.match(html, /Retíralo antes de la baja\./);
    assert.doesNotMatch(html, /Realizalas|Retiralo/);
    // Sin el módulo cargado todo sigue funcionando (texto como vino).
    const plain = loadUmd('account-deletion.js', false)._internal;
    assert.equal(plain.errorText(cause('Iniciá sesión para pedir la baja.')), 'Iniciá sesión para pedir la baja.');
    assert.equal(plain.errorText(cause('Ya tenés una solicitud de baja abierta.')), 'Ya tienes una solicitud de baja abierta.');
});

test('mapeos · colas de soporte (bajas y verificación) devuelven el texto de la base en tuteo', () => {
    const bajas = loadUmd('support-dashboard-account-deletion.js')._internal;
    const cause = (message) => ({ cause: { message } });
    assert.equal(bajas.errorText(cause('Escribí una nota para el usuario (mínimo 5 caracteres).')), 'Escribe una nota para el usuario (mínimo 5 caracteres).');
    assert.equal(bajas.errorText(cause('Escribe una nota')), 'Escribe una nota');
    assert.match(bajas.checklistHtml([{ severity: 'block', label: 'Roster', detail: '3 artista(s) con membresía activa. Finalizá las membresías primero.' }], false), /Finaliza las membresías primero\./);

    const verif = loadUmd('support-dashboard-verification.js')._internal;
    assert.equal(verif.errorText(cause('Escribí el motivo para denegar (mínimo 5 caracteres). Lo ve el artista.')), 'Escribe el motivo para denegar (mínimo 5 caracteres). Lo ve el artista.');
    assert.equal(verif.errorText(cause('Escribí la referencia de la transferencia (mínimo 3 caracteres).')), 'Escribe la referencia de la transferencia (mínimo 3 caracteres).');
    assert.equal(verif.errorText(cause('Escribe el motivo')), 'Escribe el motivo');
});

test('mapeos · inbox del estudio reconoce "No tenés/tienes acceso" y pasa a tuteo lo que deja ver', () => {
    const M = loadUmd('studio-inbox-model.js');
    const lost = 'No encontramos esa conversación en tu estudio.';
    assert.equal(M.friendlyError({ message: 'No tenés acceso al inbox de este estudio.' }), lost);
    assert.equal(M.friendlyError({ message: 'No tienes acceso al inbox de este estudio.' }), lost);
    assert.equal(M.friendlyError({ cause: { message: 'Contale al artista por qué mantenés las condiciones (mínimo 10 caracteres).' } }),
        'Cuéntale al artista por qué mantienes las condiciones (mínimo 10 caracteres).');
    // En Node (sin window) el modelo sigue exportando lo mismo.
    assert.equal(require('../public/shared/js/studio-inbox-model.js').friendlyError({ message: 'No tenés acceso a este estudio.' }), lost);
});

test('mapeos · pagos de la cotización: sesión vencida y mensajes de la RPC en las dos formas', () => {
    const window = { WoNeutralEs: N, WeotziData: { run: async () => ({}), getClient: () => null } };
    vm.runInNewContext(shared('data/quotation-payments-repo.js'), { window, console });
    const friendly = window.WeotziData.QuotationPayments.friendly;
    const expired = 'Tu sesión venció. Vuelve a iniciar sesión.';
    assert.equal(friendly({ cause: { message: 'Iniciá sesión para registrar pagos.' } }), expired);
    assert.equal(friendly({ cause: { message: 'Inicia sesión para registrar pagos.' } }), expired);
    assert.equal(friendly({ message: '[Payments.create] Elegí el tipo de pago.' }), 'Elige el tipo de pago.');
    assert.equal(friendly({ message: '[Payments.create] Elige el tipo de pago.' }), 'Elige el tipo de pago.', 'el demo ya responde en tuteo y sin tildes');
    assert.equal(friendly({ cause: { message: 'No encontramos el comprobante. Subilo de nuevo.' } }), 'No encontramos el comprobante. Súbelo de nuevo.');
    assert.equal(friendly({ cause: { message: 'Solo podés registrar pagos de cotizaciones respondidas o con acuerdo.' } }), 'Solo puedes registrar pagos de cotizaciones respondidas o con acuerdo.');
    assert.equal(friendly({ message: 'usage limit reached' }, 'genérico'), 'genérico', 'un error en inglés no se muestra');
});

// Regex de una línea de código: todas las /…/flags seguidas de .test(
function regexesOn(file, marker) {
    const line = shared(file).split(/\r?\n/).find((l) => l.includes(marker));
    assert.ok(line, `${file}: no encuentro la línea con ${marker}`);
    const found = [...line.matchAll(/\/((?:[^/\\\n]|\\.)+)\/([a-z]*)\.test\(/g)].map((m) => new RegExp(m[1], m[2]));
    assert.ok(found.length > 0, `${file}: sin regex en la línea de ${marker}`);
    return { line, found };
}

test('mapeos · las agujas que reconocen mensajes de la base aceptan voseo y tuteo', () => {
    const pairs = [
        ['artist-account.js', 'unos días/i', 'Esperá unos días antes de volver a pedir el alta.', 'Espera unos días antes de volver a pedir el alta.'],
        ['artist-account.js', 'solicitud o vínculo abierto con', 'Ya tenés una solicitud abierta.', 'Ya tienes una solicitud abierta.'],
        ['dashboard.js', 'reqError.message', 'Ya tenés una solicitud abierta.', 'Ya tienes una solicitud abierta.'],
        ['invitations-studio.js', 'un vínculo abierto con este estudio', 'Ya tenés una solicitud abierta.', 'Ya tienes una solicitud abierta.'],
        ['invitations-studio.js', 'antes de volver a pedir el alta en este estudio', 'Esperá unos días', 'Espera unos días'],
        ['studio-auth.js', 'malo/i.test', 'Ese estudio ya está en We Ötzi: reclamalo desde el registro.', 'Ese estudio ya está en We Ötzi: reclámalo desde el registro.'],
        ['studio-inbox-model.js', 'thread not found', 'No tenés acceso a este estudio.', 'No tienes acceso a este estudio.'],
        ['data/quotation-payments-repo.js', 'not authenticated', 'Iniciá sesión.', 'Inicia sesión.']
    ];
    for (const [file, marker, voseo, tuteo] of pairs) {
        const { line, found } = regexesOn(file, marker);
        assert.ok(found.some((re) => re.test(voseo)), `${file}: reconoce el voseo de la base (${voseo})`);
        assert.ok(found.some((re) => re.test(tuteo)), `${file}: reconoce el tuteo (${tuteo})`);
        // Y el copy que devuelve la línea está en tuteo.
        const copy = line.replace(/\/((?:[^/\\\n]|\\.)+)\/[a-z]*\.test\(/g, '');
        assert.deepEqual(voseoForms(copy), [], `${file}: el texto devuelto va en tuteo`);
    }
    // La base, tal como está aplicada, sigue diciendo "reclamalo": el flujo de reclamo depende de reconocerlo.
    assert.match(read('supabase', 'migrations', '20261102140000_studio_address_match.sql'), /reclamalo desde el registro/);
});
