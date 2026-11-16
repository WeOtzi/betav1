/**
 * WE ÖTZI — Español neutro en tiempo de ejecución (tuteo)
 * -------------------------------------------------------
 * Las funciones de la base ya aplicadas siguen levantando mensajes en voseo
 * ("Iniciá sesión.", "No tenés acceso a este estudio") y sus migraciones no se
 * pueden editar. Este módulo pasa ese texto a tuteo neutro justo antes de que
 * llegue a la pantalla, de forma determinística: mismo texto, mismo resultado.
 *
 *   neutralize(texto)   voseo → tuteo. Devuelve intacto lo que no es string.
 *   errorBody(cuerpo)   cuerpo de error de PostgREST (JSON crudo): message/details/hint.
 *   error(objeto)       error de supabase-js o Error: message/details/hint, en el lugar.
 *
 * Reglas, en orden (las mismas con las que se convirtió el código):
 *   1. "seña" → "anticipo" con concordancia de género ("la seña requerida" →
 *      "el anticipo requerido").
 *   2. "vos" por contexto: "con vos" → "contigo", preposición + vos → "ti",
 *      el resto → "tú".
 *   3. frases fijas ("cerca tuyo" → "cerca de ti").
 *   4. diccionario palabra por palabra, conservando mayúsculas.
 *
 * Qué NO toca: texto en inglés, identificadores (palabras con dígitos o guion
 * bajo, pegadas a - / @ # = o dentro de una dirección), variables {{...}},
 * valores entre «comillas angulares», nombres propios (mayúscula en medio de
 * la oración, o seguida de otra palabra en mayúscula: "Acá Tattoo") y
 * pretéritos en primera persona ("ya subí el comprobante", "te escribí").
 *
 * FUENTE DE VERDAD del diccionario voseo → tuteo en el repo: cualquier forma
 * nueva se agrega aquí (y tests/neutral-es.test.js comprueba que cubre todos
 * los "raise exception" de supabase/migrations).
 *
 * Lo usan lib/postgrest.js (servidor), data/postgrest-client.js y los avisos
 * (wo-notify.js y los helpers de toast/estado). En el navegador lo carga
 * config-manager.js; si no llegó a cargar, todo sigue funcionando igual.
 *
 * Módulo puro (sin DOM ni dependencias): `window.WoNeutralEs` en el navegador
 * y `require` en Node.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (root) root.WoNeutralEs = api;
}(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    // ------------------------------------------------------------ diccionario
    // voseo:tuteo, generado desde el diccionario verificado de la ronda 2.
    var DICT_SRC = [
        'probá:prueba revisá:revisa ingresá:ingresa copiá:copia confirmá:confirma completá:completa usá:usa',
        'seleccioná:selecciona recargá:recarga tocá:toca guardá:guarda intentá:intenta buscá:busca creá:crea',
        'coordiná:coordina mirá:mira explorá:explora agregá:agrega configurá:configura aceptá:acepta cargá:carga',
        'continuá:continúa entrá:entra indicá:indica dejá:deja contá:cuenta verificá:verifica validá:valida',
        'arrastrá:arrastra encontrá:encuentra pegá:pega editá:edita actualizá:actualiza publicá:publica',
        'cotizá:cotiza empezá:empieza sumá:suma marcá:marca cancelá:cancela enviá:envía reintentá:reintenta',
        'registrá:registra cambiá:cambia mandá:manda cerrá:cierra pagá:paga agendá:agenda filtrá:filtra',
        'limpiá:limpia reservá:reserva activá:activa recuperá:recupera ignorá:ignora rechazá:rechaza borrá:borra',
        'quitá:quita avisá:avisa comprobá:comprueba prepará:prepara organizá:organiza habilitá:habilita',
        'importá:importa invitá:invita aprobá:aprueba contactá:contacta mostrá:muestra generá:genera',
        'informá:informa desactivá:desactiva refrescá:refresca planificá:planifica utilizá:utiliza',
        'gestioná:gestiona sincronizá:sincroniza solicitá:solicita pasá:pasa consultá:consulta ajustá:ajusta',
        'hablá:habla adjuntá:adjunta asociá:asocia conservá:conserva pulsá:pulsa ordená:ordena archivá:archiva',
        'ejecutá:ejecuta administrá:administra girá:gira presentá:presenta calculá:calcula estimá:estima',
        'escaneá:escanea terminá:termina reembolsá:reembolsa reprogramá:reprograma recordá:recuerda llevá:lleva',
        'reclamá:reclama comenzá:comienza sacá:saca cobrá:cobra retirá:retira firmá:firma navegá:navega',
        'separá:separa refiná:refina pausá:pausa compará:compara llegá:llega descansá:descansa evitá:evita',
        'denegá:deniega avanzá:avanza conectá:conecta volvé:vuelve respondé:responde hacé:haz conocé:conoce',
        'accedé:accede proponé:propón mantené:mantén traé:trae poné:pon restablecé:restablece vendé:vende leé:lee',
        'protegé:protege tené:ten ofrecé:ofrece comé:come vení:ven podés:puedes querés:quieres recibís:recibes',
        'necesitás:necesitas trabajás:trabajas aceptás:aceptas sabés:sabes confirmás:confirmas seguís:sigues',
        'pagás:pagas enviás:envías mantenés:mantienes rechazás:rechazas respondés:respondes entrás:entras',
        'cambiás:cambias buscás:buscas elegís:eliges pedís:pides ofrecés:ofreces mostrás:muestras activás:activas',
        'quedás:quedas formás:formas encontrás:encuentras cancelás:cancelas comprás:compras reconocés:reconoces',
        'iniciás:inicias hacés:haces marcás:marcas ingresás:ingresas usás:usas subís:subes completás:completas',
        'proponés:propones publicás:publicas registrás:registras sumás:sumas imaginás:imaginas cobrás:cobras',
        'retirás:retiras creés:crees declarás:declaras importás:importas actualizás:actualizas',
        'destildás:desmarcas preferís:prefieres pensás:piensas llegás:llegas desactivás:desactivas',
        'administrás:administras volvés:vuelves manejás:manejas despachás:despachas hablás:hablas',
        'incluís:incluyes autorizás:autorizas sospechás:sospechas definís:defines vendés:vendes obtenés:obtienes',
        'aparecés:apareces invocás:invocas entendés:entiendes combinás:combinas salís:sales mandás:mandas',
        'cerrás:cierras dejás:dejas encajás:encajas retomás:retomas estimás:estimas llamás:llamas vivís:vives',
        'venís:vienes corregís:corriges ubicás:ubicas tocás:tocas revisás:revisas revocás:revocas',
        'escribís:escribes editás:editas abrís:abres armás:armas conversás:conversas configurás:configuras',
        'cargás:cargas conocés:conoces aprobás:apruebas llevás:llevas tatuás:tatúas contanos:cuéntanos',
        'escribile:escríbele contale:cuéntale pedile:pídele escribinos:escríbenos confirmalo:confírmalo',
        'revisalo:revísalo cambiala:cámbiala mandanos:mándanos copialo:cópialo avisanos:avísanos subila:súbela',
        'aprobala:apruébala registrate:regístrate contame:cuéntame pegalo:pégalo revisala:revísala',
        'respondele:respóndele ingresala:ingrésala abrilo:ábrelo mostranos:muéstranos invitalo:invítalo',
        'completalo:complétalo revisalos:revísalos avisale:avísale escribime:escríbeme mandale:mándale',
        'pagalo:págalo mandame:mándame mantenete:mantente escribila:escríbela dejalo:déjalo contales:cuéntales',
        'activalo:actívalo encontranos:encuéntranos dejanos:déjanos avisame:avísame sumate:súmate buscalo:búscalo',
        'verificalo:verifícalo validalo:valídalo sumala:súmala preparalo:prepáralo pedime:pídeme',
        'cancelalas:cancélalas acordate:acuérdate corregilo:corrígelo cancelalo:cancélalo arrastralo:arrástralo',
        'buscala:búscala seleccionala:selecciónala presentate:preséntate marcalo:márcalo agregalo:agrégalo',
        'separalas:sepáralas ponele:ponle conectate:conéctate guardalo:guárdalo proponele:proponle',
        'describila:descríbela creala:créala escribilo:escríbelo elegilo:elígelo pedila:pídela borralos:bórralos',
        'dejalos:déjalos publicalo:publícalo desactivala:desactívala gestionala:gestiónala comparalos:compáralos',
        'terminalas:termínalas hacela:hazla dejalas:déjalas publicala:publícala intentalo:inténtalo crealo:créalo',
        'editalo:edítalo tenelas:tenlas consultalo:consúltalo guardalos:guárdalos elegila:elígela',
        'archivala:archívala seleccionalo:selecciónalo sumale:súmale subilos:súbelos ordenalos:ordénalos',
        'importalos:impórtalos ingresalo:ingrésalo compartilo:compártelo rechazala:recházala asegurate:asegúrate',
        'acá:aquí sos:eres subilo:súbelo fijate:fíjate descargá:descarga confirmala:confírmala editala:edítala',
        'quitala:quítala respondelo:respóndelo activalos:actívalos andá:ve calificá:califica cerrés:cierres',
        'compartila:compártela decinos:dinos denunciá:denuncia desarchivá:desarchiva descargala:descárgala',
        'desmarcá:desmarca enterate:entérate enviale:envíale grabá:graba pedinos:pídenos vinculá:vincula decí:di',
        'pensá:piensa tomá:toma llamá:llama ayudá:ayuda preguntá:pregunta eliminá:elimina aprovechá:aprovecha',
        'mové:mueve entendé:entiende ponés:pones empezás:empiezas terminás:terminas probás:pruebas contás:cuentas',
        'recordás:recuerdas movés:mueves decidís:decides compartís:compartes conseguís:consigues guardás:guardas',
        'agregás:agregas esperás:esperas mirás:miras eliminás:eliminas olvidés:olvides decime:dime decile:dile',
        'hacelo:hazlo quedate:quédate probalo:pruébalo miralo:míralo mirala:mírala guardala:guárdala usalo:úsalo',
        'usala:úsala cambialo:cámbialo borralo:bórralo descargalo:descárgalo abrila:ábrela cerralo:ciérralo',
        'agendalo:agéndalo agendala:agéndala seguinos:síguenos ayudanos:ayúdanos preguntale:pregúntale',
        'mostrale:muéstrale contactanos:contáctanos activala:actívala dejala:déjala postulate:postúlate',
        'imprimilo:imprímelo leelos:léelos usalos:úsalos despachalos:despáchalos finalizalas:finalízalas',
        'ubicala:ubícala reasignalas:reasígnalas reabrilo:reábrelo pedíselo:pídeselo elegí:elige escribí:escribe',
        'subí:sube pedí:pide abrí:abre seguí:sigue compartí:comparte descubrí:descubre corregí:corrige',
        'definí:define repetí:repite transferí:transfiere describí:describe construí:construye permití:permite',
        'conseguí:consigue salí:sal decidí:decide incluí:incluye pagala:págalo tenés:tienes esperá:espera',
        'iniciá:inicia',
        // Formas que levantan funciones de la base ya aplicadas y que el diccionario verificado no traía.
        'finalizá:finaliza realizalas:realízalas retiralo:retíralo reclamalo:reclámalo'
    ];
    var DICT = Object.create(null);
    (function () {
        var pairs = DICT_SRC.join(' ').split(' ');
        for (var i = 0; i < pairs.length; i++) {
            var cut = pairs[i].indexOf(':');
            DICT[pairs[i].slice(0, cut)] = pairs[i].slice(cut + 1);
        }
    }());

    // ------------------------------------------------------------ límites de palabra
    // Letras con tilde incluidas; dígitos y guion bajo cuentan como parte de la
    // palabra para que un identificador (sos_token, seña2) nunca coincida.
    var W = 'A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_';
    var NB = '(^|[^' + W + '])';   // límite izquierdo sin lookbehind: se captura y se devuelve
    var NA = '(?![' + W + '])';    // límite derecho
    var WORD_RE = new RegExp('[' + W + ']+', 'g');
    var WCHAR_RE = new RegExp('[' + W + ']');
    var NEXT_WORD_RE = new RegExp('^ +([' + W + ']+)');
    var ASCII_RE = /^[A-Za-z]+$/;

    function up(s) { return s.toUpperCase(); }
    function low(s) { return s.toLowerCase(); }
    // Conserva la forma de las mayúsculas del original: TODO MAYÚSCULAS, Inicial o minúsculas.
    function cased(orig, rep) {
        if (orig.length > 1 && orig === up(orig) && orig !== low(orig)) return up(rep);
        if (orig.charAt(0) !== low(orig.charAt(0))) return up(rep.charAt(0)) + rep.slice(1);
        return rep;
    }

    // ------------------------------------------------------------ qué no se toca
    // Variables de plantilla, valores citados con «», "Lengua de señas", la clave 'seña' entre
    // comillas y dos pretéritos reales de los datos de demostración.
    var PROTECT_RE = /(\{\{[^{}]*\}\}|«[^«»]*»|[Ll]engua\s+de\s+señas|['"`]seña['"`]|Esta vez elegí a otro artista|Hola, subí los documentos de verificación)/;

    // Una palabra sin tilde pegada a estos signos es parte de un identificador, una ruta o una dirección.
    var GLUE_BEFORE = '-_/@#=&.\\';
    var GLUE_AFTER = '-_/@=';
    function glued(all, start, end) {
        var before = start > 0 ? all.charAt(start - 1) : '';
        var after = end < all.length ? all.charAt(end) : '';
        if (before && GLUE_BEFORE.indexOf(before) !== -1) return true;
        if (after && GLUE_AFTER.indexOf(after) !== -1) return true;
        return after === '.' && end + 1 < all.length && WCHAR_RE.test(all.charAt(end + 1));
    }

    function isTitle(word) {
        var first = word.charAt(0);
        return first !== low(first) && !(word.length > 1 && word === up(word));
    }
    // Nombre propio: Inicial mayúscula en medio de la oración ("enviada a Acá Tattoo")
    // o, al empezar, seguida de otra palabra con Inicial mayúscula ("Acá Tattoo te invitó").
    function looksLikeName(all, start, end) {
        var i = start - 1;
        while (i >= 0 && (all.charAt(i) === ' ' || all.charAt(i) === '\t')) i--;
        if (i >= 0) {
            var prev = all.charAt(i);
            if (prev === ',' || prev === ';' || WCHAR_RE.test(prev)) return true;
        }
        var next = NEXT_WORD_RE.exec(all.slice(end, end + 48));
        return !!next && isTitle(next[1]);
    }

    // Pretérito en primera persona: "ya subí", "te escribí", "no lo elegí" tienen la
    // misma forma que el imperativo voseante, pero no son voseo y se dejan.
    var PRETERITE_BEFORE = { ya: 1, yo: 1, no: 1, nunca: 1, me: 1, te: 1, lo: 1, la: 1, los: 1, las: 1, le: 1, les: 1 };
    function isAmbiguous(key) {
        return key.charAt(key.length - 1) === 'í' && key !== 'vení' && key !== 'decí';
    }
    function prevWord(all, start) {
        var i = start - 1;
        while (i >= 0 && (all.charAt(i) === ' ' || all.charAt(i) === '\t')) i--;
        if (i < 0 || i === start - 1) return '';
        var j = i;
        while (j >= 0 && WCHAR_RE.test(all.charAt(j))) j--;
        return low(all.slice(j + 1, i + 1));
    }

    // ------------------------------------------------------------ 1. seña → anticipo
    // "anticipo" es masculino: concuerdan el determinante ("de la" → "del"), el adjetivo
    // antepuesto ("la misma seña") y hasta dos adjetivos o participios pospuestos, también
    // tras verbo ("la seña requerida ya fue pagada" → "el anticipo requerido ya fue pagado").
    var MASC = { requerida: 'requerido', recibida: 'recibido', registrada: 'registrado', confirmada: 'confirmado', acordada: 'acordado', pactada: 'pactado', pagada: 'pagado', pedida: 'pedido', sugerida: 'sugerido', 'mínima': 'mínimo', cobrada: 'cobrado', abonada: 'abonado', devuelta: 'devuelto', reembolsada: 'reembolsado', incluida: 'incluido', completa: 'completo', previa: 'previo', necesaria: 'necesario', obligatoria: 'obligatorio', fija: 'fijo', 'única': 'único', entregada: 'entregado', transferida: 'transferido', solicitada: 'solicitado', definida: 'definido', acreditada: 'acreditado', verificada: 'verificado', rechazada: 'rechazado', vencida: 'vencido', protegida: 'protegido', adeudada: 'adeudado', propuesta: 'propuesto', indicada: 'indicado', informada: 'informado', cargada: 'cargado', cubierta: 'cubierto', esa: 'ese', esta: 'este', misma: 'mismo', otra: 'otro', nueva: 'nuevo', primera: 'primer', segunda: 'segundo', 'última': 'último', 'próxima': 'próximo', dicha: 'dicho', ninguna: 'ningún', alguna: 'algún', una: 'un', la: 'el' };
    var MASC_PL = { requeridas: 'requeridos', recibidas: 'recibidos', registradas: 'registrados', confirmadas: 'confirmados', pagadas: 'pagados', cobradas: 'cobrados', protegidas: 'protegidos', las: 'los', unas: 'unos', estas: 'estos', esas: 'esos', mismas: 'mismos', otras: 'otros', nuevas: 'nuevos', primeras: 'primeros', 'últimas': 'últimos', 'próximas': 'próximos', muchas: 'muchos', algunas: 'algunos' };
    var DET_SG = ['la', 'una', 'esta', 'esa', 'misma', 'otra', 'nueva', 'primera', 'dicha', 'ninguna', 'alguna'];
    var DET_PL = ['las', 'unas', 'estas', 'esas', 'otras', 'nuevas', 'muchas', 'algunas'];
    var PRE_SG = ['misma', 'otra', 'nueva', 'primera', 'segunda', 'última', 'próxima', 'única'];
    var PRE_PL = ['mismas', 'otras', 'nuevas', 'primeras', 'últimas', 'próximas'];
    var DET_MAP = { 'de la': 'del', 'a la': 'al', 'toda la': 'todo el', 'de las': 'de los', 'a las': 'a los', 'todas las': 'todos los' };
    var LETTERS = '[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+';
    function without(map, list, extra) {
        var out = [];
        for (var k in map) {
            if (Object.prototype.hasOwnProperty.call(map, k) && list.indexOf(k) === -1 && extra.indexOf(k) === -1) out.push(k);
        }
        return out.join('|');
    }
    // Entre el sustantivo y el adjetivo: adverbios y un verbo copulativo ("todavía no fue").
    var ADV = '(?:\\s+(?:ya|no|aún|todavía)){0,2}';
    var ADV2 = '(?:\\s+(?:ya|no|como))?\\s+';
    var COP = '\\s+(?:está|esté|queda|quedó|quede|fue|es|sigue|figura|aparece)';
    var COP_PL = '\\s+(?:están|estén|quedan|quedaron|fueron|son|siguen|figuran|aparecen)';
    // Cola concordante: adjetivo de la lista (con o sin verbo) o, solo tras verbo copulativo,
    // cualquier participio femenino ("fue retenida"). Se captura entera y se ajusta su última palabra.
    function tail(cop, known, participle) {
        return '(?:(' + ADV + '(?:' + cop + ')?' + ADV2 + '(?:' + known + ')|' + ADV + cop + ADV2 + LETTERS + participle + ')' + NA + ')?';
    }
    var TAIL = tail(COP, without(MASC, DET_SG, PRE_SG) + '|única', '(?:ada|ida)');
    var TAIL_PL = tail(COP_PL, without(MASC_PL, DET_PL, PRE_PL), '(?:adas|idas)');
    var SENA_SG = new RegExp(NB + '(?:(de\\s+la|a\\s+la|toda\\s+la|' + DET_SG.join('|') + ')(\\s+))?(?:(' + PRE_SG.join('|') + ')(\\s+))?(seña)' + NA
        + TAIL + TAIL, 'gi');
    var SENA_PL = new RegExp(NB + '(?:(de\\s+las|a\\s+las|todas\\s+las|' + DET_PL.join('|') + ')(\\s+))?(?:(' + PRE_PL.join('|') + ')(\\s+))?(señas)' + NA
        + TAIL_PL + TAIL_PL, 'gi');
    var LAST_WORD_RE = /\S+$/;
    function senaReplacer(masc, noun) {
        function agree(word) {
            var key = low(word);
            if (masc[key]) return cased(word, masc[key]);
            // participio fuera de la lista: "retenida" → "retenido", "liberadas" → "liberados"
            if (key.length >= 6) return cased(word, key.replace(/a(s?)$/, 'o$1'));
            return word; // "nada", "cada": no son participios
        }
        return function (m, pre, det, sp, preAdj, sp2, word, tail1, tail2) {
            var out = pre;
            if (det) {
                var key = low(det).replace(/\s+/g, ' ');
                out += cased(det, DET_MAP[key] || masc[key]) + sp;
            }
            if (preAdj) out += agree(preAdj) + sp2;
            out += cased(word, noun);
            if (tail1) out += tail1.replace(LAST_WORD_RE, agree);
            if (tail2) out += tail2.replace(LAST_WORD_RE, agree);
            return out;
        };
    }
    var SENA_SG_FN = senaReplacer(MASC, 'anticipo');
    var SENA_PL_FN = senaReplacer(MASC_PL, 'anticipos');

    // ------------------------------------------------------------ 2. vos
    var VOS_RE = new RegExp(NB + '(?:(con|para|a|de|por|en|sobre|sin|hacia|ante|tras|desde|contra|hasta)(\\s+))?(vos)' + NA, 'gi');
    function vosReplacer(m, pre, prep, sp, vos, offset, all) {
        var end = offset + m.length;
        var start = end - vos.length;
        if (glued(all, start, end)) return m;
        if (isTitle(vos) && looksLikeName(all, start, end)) return m;
        if (!prep) return pre + cased(vos, 'tú');
        if (low(prep) === 'con') return pre + cased(prep, 'contigo');
        return pre + prep + sp + cased(vos, 'ti');
    }

    // ------------------------------------------------------------ 3. frases fijas
    var CERCA_RE = new RegExp(NB + '(cerca)(\\s+)(tuyo)' + NA, 'gi');
    function cercaReplacer(m, pre, cerca, sp, tuyo) {
        return pre + cerca + sp + (tuyo === up(tuyo) ? 'DE TI' : 'de ti');
    }

    // ------------------------------------------------------------ 4. diccionario
    function wordReplacer(word, offset, all) {
        var key = low(word);
        var rep = DICT[key];
        if (rep === undefined) return word;
        var end = offset + word.length;
        if (ASCII_RE.test(word) && glued(all, offset, end)) return word;
        if (isTitle(word) && looksLikeName(all, offset, end)) return word;
        if (isAmbiguous(key) && PRETERITE_BEFORE[prevWord(all, offset)] === 1) return word;
        return cased(word, rep);
    }

    function neutralizePlain(text) {
        var lower = low(text);
        var out = text;
        if (lower.indexOf('seña') !== -1) out = out.replace(SENA_SG, SENA_SG_FN).replace(SENA_PL, SENA_PL_FN);
        if (lower.indexOf('vos') !== -1) out = out.replace(VOS_RE, vosReplacer);
        if (lower.indexOf('tuyo') !== -1) out = out.replace(CERCA_RE, cercaReplacer);
        return out.replace(WORD_RE, wordReplacer);
    }

    /** Pasa un texto de voseo a tuteo neutro. Idempotente; lo que no es string vuelve intacto. */
    function neutralize(text) {
        if (typeof text !== 'string' || text.length < 3) return text;
        if (!PROTECT_RE.test(text)) return neutralizePlain(text);
        var parts = text.split(PROTECT_RE);
        for (var i = 0; i < parts.length; i += 2) parts[i] = neutralizePlain(parts[i]);
        return parts.join('');
    }

    // ------------------------------------------------------------ errores de la base
    var ERROR_FIELDS = ['message', 'details', 'hint'];

    /** Error de supabase-js / PostgREST (o un Error): pasa a tuteo message, details y hint en el lugar. */
    function neutralizeError(err) {
        if (!err || typeof err !== 'object') return err;
        for (var i = 0; i < ERROR_FIELDS.length; i++) {
            var field = ERROR_FIELDS[i];
            if (typeof err[field] !== 'string') continue;
            var next = neutralize(err[field]);
            if (next !== err[field]) {
                try { err[field] = next; } catch (e) { /* objeto congelado: se deja como vino */ }
            }
        }
        return err;
    }

    /**
     * Cuerpo de error de PostgREST tal como llega por HTTP. Si es el JSON
     * {code, message, details, hint} solo se tocan esos tres textos; si es
     * texto plano se neutraliza entero. Sin cambios devuelve el mismo string.
     */
    function neutralizeErrorBody(text) {
        if (typeof text !== 'string' || !text) return text;
        if (text.charAt(0) === '{') {
            try {
                var body = JSON.parse(text);
                if (body && typeof body === 'object' && !Array.isArray(body)) {
                    var changed = false;
                    for (var i = 0; i < ERROR_FIELDS.length; i++) {
                        var field = ERROR_FIELDS[i];
                        if (typeof body[field] !== 'string') continue;
                        var next = neutralize(body[field]);
                        if (next !== body[field]) { body[field] = next; changed = true; }
                    }
                    return changed ? JSON.stringify(body) : text;
                }
            } catch (e) { /* no es JSON válido: se trata como texto */ }
        }
        return neutralize(text);
    }

    return {
        neutralize: neutralize,
        errorBody: neutralizeErrorBody,
        error: neutralizeError,
        DICT: Object.freeze(DICT)
    };
}));
