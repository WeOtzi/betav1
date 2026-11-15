/**
 * WE ÖTZI · Cotizador · Modelo puro del paso "¿Qué estilo estás buscando?"
 * -----------------------------------------------------------------------
 * 1. Estilos del artista: cruza artists_db.styles_array (etiquetas del
 *    registro nuevo, viejas, en mayúsculas, sin tildes…) con el catálogo de
 *    tattoo_styles para marcar con "Artista" los que trabaja.
 * 2. Estilos recomendados: analiza la idea que escribió el cliente con
 *    palabras clave y sinónimos por estilo (sin IA externa) y devuelve los
 *    estilos sugeridos con el motivo.
 * 3. Orden de la grilla: primero los del artista (o los recomendados si no
 *    hay artista) y después el resto en el orden del catálogo.
 *
 * El catálogo de palabras clave cubre los estilos base del cotizador y los de
 * lib/expanded-tattoo-styles.js (tests/r2-cot-pasos-estilos.test.js lo exige).
 * Sin DOM ni red. Navegador: window.WoQuotationStyleModel · Node: require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoQuotationStyleModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var WEIGHTS = { name: 6, strong: 3, hint: 2, weak: 1 };
    var MIN_SCORE = 2;
    var DEFAULT_LIMIT = 4;
    var MAX_LIMIT = 8;
    var MAX_IDEA_LENGTH = 2000;

    // ---------- Normalización ----------
    // Minúsculas, sin tildes, solo letras y números separados por un espacio.
    function normalizeWords(value) {
        return String(value === null || value === undefined ? '' : value)
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    // Forma compacta: "Neo-Tradicional" → "neotradicional".
    function compactKey(value) {
        return normalizeWords(value).replace(/ /g, '');
    }

    var PREFIXES = ['neo', 'micro', 'hiper', 'hyper', 'semi', 'post'];
    var STOPWORDS = ['y', 'and', 'de', 'del', 'la', 'el', 'en', 'a', 'con'];

    // Palabras de una etiqueta. Un prefijo suelto se pega a la palabra que
    // sigue ("Neo Tradicional" → neotradicional) para que no cuente como
    // "Tradicional".
    function tokens(value) {
        var raw = normalizeWords(String(value || '').replace(/-/g, '')).split(' ').filter(Boolean);
        var out = [];
        for (var i = 0; i < raw.length; i++) {
            if (PREFIXES.indexOf(raw[i]) !== -1 && raw[i + 1]) {
                out.push(raw[i] + raw[i + 1]);
                i++;
            } else if (STOPWORDS.indexOf(raw[i]) === -1) {
                out.push(raw[i]);
            }
        }
        return out;
    }

    // ---------- Equivalencias entre etiquetas ----------
    // Mismo estilo con distintos nombres: el catálogo del cotizador
    // (tattoo_styles), el del registro de tatuadores
    // (lib/registration-catalogs.js) y lo que ya está guardado en styles_array.
    var ALIAS_GROUPS = [
        ['Realismo', 'REALIMSMO', 'Realista', 'Realism'],
        ['Hiperrealismo', 'Hiperrealista', 'Hyperrealism'],
        ['Microrealismo', 'Micro-realismo', 'Micro realismo', 'Microrealism'],
        ['Fine Line', 'FINELINE', 'Fineline', 'Línea fina'],
        ['Black & Grey', 'Black and Grey', 'Black and Gray', 'Black & Gray', 'Negro y gris'],
        ['Tradicional', 'Tradicional Americano (Old School)', 'Tradicional americano', 'Old School', 'American Traditional'],
        ['Neo-Tradicional', 'Neotradicional', 'Neo Tradicional', 'Neo Traditional'],
        ['Japonés', 'Tradicional Japonés (Irezumi)', 'Japones', 'Irezumi', 'Japanese'],
        ['Neo-Japanese', 'Neojaponés', 'Neo Japonés', 'Neojapones'],
        ['Geométrico', 'Geometrico', 'Geometric'],
        ['Lettering', 'Lettering / Caligrafía'],
        ['Acuarela', 'Acuarela (Watercolor)', 'Watercolor'],
        ['Surrealista', 'Surrealismo'],
        ['Mandala', 'Mandalas'],
        ['Polinesio', 'Tribal Polinesio'],
        ['Nordico / Viking', 'Nórdico', 'Nordico', 'Viking', 'Vikingo'],
        ['Etching / Grabado', 'Grabado (Engraving)', 'Grabado', 'Etching'],
        ['Woodcut / Xilografia', 'Xilografía (Woodcut)', 'Xilografia', 'Woodcut'],
        ['Sketch / Boceto', 'Sketch', 'Boceto'],
        ['Blackletter / Gotico', 'Gothic Lettering', 'Blackletter'],
        ['Ignorant', 'Ignorant Style'],
        ['Ilustracion botanica', 'Botánico', 'Fineline botanico'],
        ['Pointillism', 'Puntillismo Geométrico', 'Puntillismo'],
        ['Ornamental Blackwork', 'Blackwork Ornamental'],
        ['Glitch', 'Glitch Tattoo'],
        ['CYBERSIGILISMO', 'Cibersigilismo (Cybersigilism)', 'Cybersigilismo', 'Cybersigilism', 'Cibersigilismo'],
        ['FREEHAND', 'Freehand Abstract', 'Freehand'],
        ['Abstract Brush', 'Brushstroke'],
        ['Neotribal (Neo Tribal)', 'Neotribal', 'Neo Tribal'],
        ['Retrato', 'Retratos'],
        ['Handpoke / Stick and Poke', 'Handpoke', 'Stick and Poke'],
        ['Religious / Sacro', 'Religioso', 'Sacro']
    ];

    var CANONICAL = (function () {
        var map = {};
        ALIAS_GROUPS.forEach(function (group) {
            var keys = group.map(compactKey);
            // Si una etiqueta ya pertenece a otro grupo, se unen.
            var target = keys[0];
            keys.forEach(function (key) { if (map[key]) target = map[key]; });
            keys.forEach(function (key) {
                var previous = map[key];
                if (previous && previous !== target) {
                    Object.keys(map).forEach(function (k) { if (map[k] === previous) map[k] = target; });
                }
                map[key] = target;
            });
        });
        return map;
    }());

    function canonicalKey(value) {
        var key = compactKey(value);
        return CANONICAL[key] || key;
    }

    function sameStyle(a, b) {
        var ka = canonicalKey(a);
        return !!ka && ka === canonicalKey(b);
    }

    // ---------- Catálogo ----------
    // Estilos base del cotizador + lib/expanded-tattoo-styles.js. Solo se usa
    // cuando no hay catálogo de tattoo_styles a mano (respaldo del endpoint).
    var STATIC_CATALOG = [
        ['Realismo', 'realismo'], ['Tradicional', 'tradicional'], ['Neo-Tradicional', 'neo_tradicional'],
        ['Japonés', 'japones'], ['Minimalista', 'minimalista'], ['Fine Line', 'fine_line'],
        ['Blackwork', 'blackwork'], ['Dotwork', 'dotwork'], ['Acuarela', 'acuarela'],
        ['Geométrico', 'geometrico'], ['Trash Polka', 'trash_polka'], ['Chicano', 'chicano'],
        ['New School', 'new_school'], ['Anime', 'anime'], ['Ilustrativo', 'ilustrativo'],
        ['Surrealista', 'surrealista'], ['Black & Grey', 'black_grey'], ['Microrealismo', 'microrealismo'],
        ['Hiperrealismo', 'hiperrealismo'], ['Ornamental', 'ornamental'], ['Mandala', 'mandala'],
        ['Tribal', 'tribal'], ['Polinesio', 'polinesio'], ['Maori', 'maori'], ['Haida', 'haida'],
        ['Celta', 'celta'], ['Nordico / Viking', 'nordico_viking'], ['Lettering', 'lettering'],
        ['Blackletter / Gotico', 'blackletter_gotico'], ['Caligrafia', 'caligrafia'], ['Ignorant', 'ignorant'],
        ['Handpoke / Stick and Poke', 'handpoke_stick_and_poke'], ['Abstracto', 'abstracto'],
        ['Sketch / Boceto', 'sketch_boceto'], ['Etching / Grabado', 'etching_grabado'],
        ['Woodcut / Xilografia', 'woodcut_xilografia'], ['Linework', 'linework'],
        ['Ilustracion botanica', 'ilustracion_botanica'], ['Floral', 'floral'],
        ['Fineline botanico', 'fineline_botanico'], ['Biomecanico', 'biomecanico'],
        ['Bioorganico', 'bioorganico'], ['Horror', 'horror'], ['Dark Art', 'dark_art'], ['Glitch', 'glitch'],
        ['Pixel Art', 'pixel_art'], ['Graffiti', 'graffiti'], ['Pop Art', 'pop_art'],
        ['Art Nouveau', 'art_nouveau'], ['Art Deco', 'art_deco'], ['Barroco', 'barroco'],
        ['Abstract Brush', 'abstract_brush'], ['Patchwork', 'patchwork'],
        ['Religious / Sacro', 'religious_sacro'], ['Ornamental Blackwork', 'ornamental_blackwork'],
        ['Pointillism', 'pointillism']
    ].map(function (row) {
        return { id: row[1], slug: row[1].replace(/_/g, '-'), name: row[0], substyles: [] };
    });

    // ---------- Palabras clave por estilo ----------
    // n: el estilo nombrado tal cual · s: señal fuerte · h: tema muy asociado ·
    // w: señal débil. La clave es el `value` del catálogo.
    var STYLE_KEYWORDS = {
        realismo: {
            n: ['realismo', 'realista', 'realistic', 'realism'],
            s: ['retrato', 'fotorrealista', 'fotografía', 'foto', 'fotográfico', 'hiperdetallado'],
            h: ['rostro', 'cara', 'mirada', 'ojo', 'león', 'tigre', 'lobo', 'águila', 'caballo', 'mascota', 'perro', 'gato', 'elefante', 'oso', 'búho', 'reloj', 'estatua', 'escultura', 'ángel'],
            w: ['animal', 'familia', 'hijo', 'hija', 'madre', 'padre', 'mamá', 'papá', 'abuelo', 'abuela', 'homenaje', 'paisaje', 'naturaleza', 'sombras', 'detalle']
        },
        tradicional: {
            n: ['tradicional', 'old school', 'oldschool', 'tradicional americano', 'american traditional'],
            s: ['ancla', 'golondrina', 'daga', 'puñal', 'pin up', 'pinup', 'marinero', 'sailor jerry', 'pantera', 'líneas gruesas'],
            h: ['rosa', 'águila', 'calavera', 'cráneo', 'serpiente', 'corazón', 'barco', 'velero', 'faro', 'mariposa', 'cuchillo', 'dados'],
            w: ['colores sólidos', 'clásico', 'vintage', 'retro']
        },
        neo_tradicional: {
            n: ['neo tradicional', 'neotradicional', 'neo traditional', 'neotraditional'],
            s: ['animal con flores', 'retrato de mujer con flores', 'líneas marcadas y color'],
            h: ['león', 'lobo', 'zorro', 'búho', 'ciervo', 'mujer', 'rosa', 'mariposa', 'colibrí', 'serpiente', 'daga', 'gato', 'calavera', 'pantera', 'tigre'],
            w: ['colorido', 'color', 'ornamentos', 'joyas', 'flores', 'animal']
        },
        japones: {
            n: ['tradicional japonés', 'tradicional japonesa', 'estilo japonés', 'japonés', 'japonesa', 'irezumi', 'oriental', 'japanese', 'japón'],
            s: ['dragón', 'koi', 'carpa', 'samurái', 'geisha', 'hannya', 'oni', 'kitsune', 'sakura', 'flor de cerezo', 'cerezo', 'katana', 'kanagawa', 'gran ola', 'crisantemo', 'peonía', 'grulla', 'daruma', 'foo dog'],
            h: ['olas', 'tigre', 'serpiente', 'máscara', 'nubes', 'fénix', 'viento'],
            w: ['manga completa', 'espalda completa', 'tradición']
        },
        minimalista: {
            n: ['minimalista', 'minimalismo', 'minimal'],
            s: ['simple', 'sencillo', 'sencilla', 'pequeño', 'pequeña', 'chiquito', 'chiquita', 'discreto', 'discreta', 'sutil', 'mini'],
            h: ['símbolo', 'inicial', 'iniciales', 'fecha', 'corazoncito', 'estrella', 'luna', 'sol', 'onda', 'avión', 'punto y coma', 'infinito', 'coordenadas', 'números romanos', 'huella'],
            w: ['línea', 'líneas', 'contorno', 'silueta', 'delicado', 'delicada']
        },
        fine_line: {
            n: ['fine line', 'fineline', 'línea fina', 'líneas finas', 'trazo fino', 'single needle'],
            s: ['delicado', 'delicada', 'fino', 'fina', 'sutil', 'elegante'],
            h: ['flor', 'flores', 'ramo', 'ramita', 'hoja', 'hojas', 'mariposa', 'constelación', 'frase', 'nombre', 'silueta', 'pájaro', 'colibrí', 'lavanda', 'luna'],
            w: ['pequeño', 'pequeña', 'simple', 'femenino', 'minimal']
        },
        blackwork: {
            n: ['blackwork', 'black work', 'blackout', 'negro sólido', 'tinta negra sólida'],
            s: ['negro pleno', 'relleno negro', 'mancha negra', 'todo negro', 'solo negro', 'bloques negros'],
            h: ['calavera', 'cuervo', 'serpiente', 'polilla', 'murciélago', 'ocultismo', 'bosque', 'lobo', 'daga', 'tarot'],
            w: ['negro', 'oscuro', 'contraste', 'sólido']
        },
        dotwork: {
            n: ['dotwork', 'dot work'],
            s: ['puntos', 'punteado', 'a puntos', 'hecho con puntos'],
            h: ['mandala', 'geometría sagrada', 'luna', 'sol', 'planeta', 'flor de loto', 'loto'],
            w: ['degradado', 'sombreado', 'textura']
        },
        acuarela: {
            n: ['acuarela', 'acuarelas', 'watercolor', 'aquarela'],
            s: ['manchas de color', 'salpicaduras', 'pinceladas de color', 'difuminado', 'colores difuminados', 'pintura'],
            h: ['colibrí', 'mariposa', 'flor', 'flores', 'pluma', 'zorro', 'galaxia', 'pájaro'],
            w: ['colorido', 'colores', 'color', 'pastel', 'suave']
        },
        geometrico: {
            n: ['geométrico', 'geométrica', 'geometría', 'geometric'],
            s: ['triángulo', 'círculo', 'hexágono', 'polígono', 'líneas rectas', 'simetría', 'simétrico', 'geometría sagrada', 'cubo', 'figuras geométricas', 'flor de la vida', 'metatrón'],
            h: ['montaña', 'montañas', 'flecha', 'brújula', 'animal geométrico', 'lobo geométrico'],
            w: ['líneas', 'patrón', 'patrones']
        },
        trash_polka: {
            n: ['trash polka', 'trashpolka'],
            s: ['rojo y negro', 'negro y rojo', 'collage', 'manchas rojas', 'pinceladas rojas', 'caótico'],
            h: ['calavera', 'reloj', 'cuervo'],
            w: ['retrato', 'tipografía', 'abstracto', 'agresivo']
        },
        chicano: {
            n: ['chicano', 'chicana', 'cholo', 'chola'],
            s: ['payasa', 'payaso', 'lowrider', 'virgen de guadalupe', 'guadalupe', 'pachuco', 'pachuca', 'catrina', 'santa muerte', 'barrio', 'smile now cry later', 'charra'],
            h: ['virgen', 'rosario', 'manos rezando', 'rosa', 'calavera', 'familia', 'nombre', 'cruz'],
            w: ['negro y gris', 'sombras', 'lettering']
        },
        new_school: {
            n: ['new school', 'newschool'],
            s: ['caricatura', 'cartoon', 'caricaturesco', 'exagerado', 'dibujos animados'],
            h: ['personaje', 'monstruo', 'comida', 'videojuego', 'graffiti'],
            w: ['colorido', 'colores vivos', 'divertido', 'color']
        },
        anime: {
            n: ['anime', 'otaku', 'estilo manga', 'manga japonés'],
            s: ['naruto', 'goku', 'dragon ball', 'one piece', 'luffy', 'pokemon', 'pikachu', 'studio ghibli', 'ghibli', 'totoro', 'sailor moon', 'evangelion', 'attack on titan', 'shingeki', 'demon slayer', 'kimetsu', 'jujutsu', 'berserk', 'bleach', 'death note', 'akatsuki', 'sharingan', 'hunter x hunter', 'chainsaw man', 'my hero academia', 'tokyo ghoul'],
            h: ['personaje', 'kawaii', 'chibi', 'waifu'],
            w: ['caricatura', 'videojuego']
        },
        ilustrativo: {
            n: ['ilustrativo', 'ilustrativa', 'ilustración', 'ilustrado'],
            s: ['dibujo', 'estilo dibujo', 'cuento', 'libro ilustrado', 'storybook'],
            h: ['personaje', 'animal', 'paisaje', 'escena'],
            w: ['líneas', 'color', 'detalle']
        },
        surrealista: {
            n: ['surrealista', 'surrealismo', 'surreal', 'onírico'],
            s: ['dalí', 'sueño', 'sueños', 'imposible', 'fantasía', 'ojo flotante', 'reloj derretido', 'relojes derretidos', 'magritte'],
            h: ['astronauta', 'universo', 'cosmos', 'mente', 'metamorfosis', 'ojo'],
            w: ['extraño', 'raro', 'abstracto', 'imaginación']
        },
        black_grey: {
            n: ['black and grey', 'black grey', 'black and gray', 'black gray', 'negro y gris', 'blanco y negro', 'escala de grises'],
            s: ['sombreado', 'sombras suaves', 'sin color', 'a una tinta'],
            h: ['retrato', 'realista', 'rosa', 'reloj', 'león', 'ángel', 'estatua'],
            w: ['sombras', 'negro']
        },
        microrealismo: {
            n: ['microrealismo', 'micro realismo', 'microrealista', 'micro realista'],
            s: ['realista pequeño', 'pequeño realista', 'miniatura', 'mini retrato', 'diminuto'],
            h: ['retrato pequeño', 'mascota', 'foto', 'paisaje pequeño'],
            w: ['pequeño', 'pequeña', 'detalle', 'fino', 'realista']
        },
        hiperrealismo: {
            n: ['hiperrealismo', 'hiperrealista', 'hiper realista', 'hiper realismo', 'hyperrealismo'],
            s: ['como una foto', 'parece foto', 'ultra realista', 'ultrarealista', '3d', 'efecto 3d'],
            h: ['retrato', 'ojo', 'piel rasgada', 'gotas', 'textura'],
            w: ['realista', 'detalle']
        },
        ornamental: {
            n: ['ornamental', 'ornamento', 'ornamentos'],
            s: ['filigrana', 'encaje', 'joya', 'joyas', 'brazalete', 'tobillera', 'collar', 'candelabro', 'chandelier', 'underboob'],
            h: ['mandala', 'henna', 'mehndi', 'adorno', 'arabescos', 'simétrico'],
            w: ['decorativo', 'elegante', 'femenino', 'simetría']
        },
        mandala: {
            n: ['mandala', 'mandalas'],
            s: ['flor de loto', 'loto', 'henna', 'mehndi', 'chakra'],
            h: ['geometría sagrada', 'simétrico', 'hindú', 'budista', 'yoga', 'circular'],
            w: ['puntos', 'espiritual', 'equilibrio']
        },
        tribal: {
            n: ['tribal', 'tribales'],
            s: ['formas negras', 'líneas negras gruesas', 'tribu', 'étnico'],
            h: ['brazalete', 'sol tribal', 'tiburón', 'tortuga'],
            w: ['negro', 'sólido', 'ancestral']
        },
        polinesio: {
            n: ['polinesio', 'polinesia', 'polinésico', 'samoano', 'hawaiano', 'tahitiano'],
            s: ['tiki', 'marquesas', 'moana'],
            h: ['tortuga', 'tiburón', 'olas', 'mar', 'tribal'],
            w: ['ancestral', 'patrón', 'isla']
        },
        maori: {
            n: ['maorí', 'ta moko', 'moko'],
            s: ['koru', 'nueva zelanda', 'hei tiki', 'haka'],
            h: ['tribal', 'helecho', 'espiral'],
            w: ['ancestral', 'patrón']
        },
        haida: {
            n: ['haida'],
            s: ['tótem', 'orca', 'nativo americano', 'nativos americanos'],
            h: ['águila', 'oso', 'lobo', 'ballena', 'salmón', 'cuervo'],
            w: ['rojo y negro', 'tribal']
        },
        celta: {
            n: ['celta', 'celtas', 'celtic', 'irlandés'],
            s: ['nudo celta', 'trinity', 'triqueta', 'triquetra', 'trisquel', 'triskel', 'cruz celta', 'claddagh', 'árbol de la vida'],
            h: ['nudo', 'trébol', 'druida', 'irlanda', 'escocia'],
            w: ['entrelazado', 'símbolo']
        },
        nordico_viking: {
            n: ['nórdico', 'nórdica', 'vikingo', 'vikinga', 'viking', 'vikingos'],
            s: ['runa', 'runas', 'vegvisir', 'valknut', 'yggdrasil', 'odín', 'thor', 'mjolnir', 'valhalla', 'drakkar', 'fenrir', 'ragnar', 'loki'],
            h: ['hacha', 'cuervo', 'lobo', 'guerrero', 'escudo', 'brújula'],
            w: ['mitología', 'símbolo']
        },
        lettering: {
            n: ['lettering', 'letras', 'letra', 'tipografía'],
            s: ['frase', 'palabra', 'nombre', 'nombres', 'texto', 'cita', 'fecha', 'iniciales', 'inicial', 'números romanos', 'verso'],
            h: ['mensaje', 'canción', 'poema', 'apellido', 'firma'],
            w: ['recuerdo', 'homenaje']
        },
        blackletter_gotico: {
            n: ['blackletter', 'gótico', 'gótica', 'letras góticas', 'old english', 'gothic'],
            s: ['letra gótica', 'tipografía gótica', 'fraktur', 'medieval'],
            h: ['frase', 'nombre', 'apellido', 'palabra'],
            w: ['letras', 'oscuro']
        },
        caligrafia: {
            n: ['caligrafía', 'caligráfico', 'cursiva', 'manuscrita', 'script'],
            s: ['letra cursiva', 'letra manuscrita', 'puño y letra', 'escritura', 'firma'],
            h: ['frase', 'nombre', 'palabra', 'cita', 'poema'],
            w: ['letras', 'elegante', 'fino']
        },
        ignorant: {
            n: ['ignorant', 'ignorant style'],
            s: ['mal dibujado', 'infantil', 'naif', 'garabato', 'dibujo de niño', 'irónico'],
            h: ['chiste', 'meme', 'gracioso', 'humor'],
            w: ['divertido', 'simple']
        },
        handpoke_stick_and_poke: {
            n: ['handpoke', 'hand poke', 'stick and poke', 'stick n poke', 'stick poke', 'sin máquina'],
            s: ['punto por punto', 'artesanal', 'a mano'],
            h: ['símbolo', 'pequeño', 'pequeña', 'simple'],
            w: ['delicado', 'minimalista']
        },
        abstracto: {
            n: ['abstracto', 'abstracta', 'abstracción', 'abstract'],
            s: ['formas abstractas', 'manchas', 'sin forma', 'trazos libres', 'composición libre', 'arte abstracto'],
            h: ['pinceladas', 'movimiento', 'emoción'],
            w: ['libre', 'experimental', 'líneas']
        },
        sketch_boceto: {
            n: ['sketch', 'boceto', 'bosquejo', 'esbozo'],
            s: ['a lápiz', 'lápiz', 'trazos sueltos', 'líneas de construcción', 'sin terminar', 'mano alzada'],
            h: ['dibujo', 'arquitectura'],
            w: ['líneas', 'artístico']
        },
        etching_grabado: {
            n: ['etching', 'grabado', 'engraving', 'aguafuerte'],
            s: ['grabado antiguo', 'ilustración antigua', 'tramado', 'rayado', 'estilo billete'],
            h: ['medieval', 'alquimia', 'calavera', 'anatomía', 'sol y luna'],
            w: ['vintage', 'antiguo']
        },
        woodcut_xilografia: {
            n: ['woodcut', 'xilografía', 'linograbado', 'linocut'],
            s: ['madera tallada', 'grabado en madera', 'estampa'],
            h: ['tarot', 'medieval', 'calavera', 'diablo', 'santo'],
            w: ['antiguo', 'vintage']
        },
        linework: {
            n: ['linework', 'line work', 'solo líneas', 'solo línea', 'lineal'],
            s: ['contorno', 'contornos', 'una sola línea', 'línea continua', 'outline', 'sin relleno', 'sin sombra', 'sin sombras'],
            h: ['rostro', 'silueta', 'mano', 'manos'],
            w: ['simple', 'minimalista', 'línea', 'líneas']
        },
        ilustracion_botanica: {
            n: ['ilustración botánica', 'botánico', 'botánica'],
            s: ['planta', 'plantas', 'helecho', 'rama', 'ramas', 'hierbas', 'herbario', 'eucalipto', 'olivo', 'monstera', 'cactus', 'suculenta', 'hongo', 'hongos', 'setas'],
            h: ['hoja', 'hojas', 'flor', 'flores', 'naturaleza', 'jardín', 'árbol'],
            w: ['verde', 'natural']
        },
        floral: {
            n: ['floral', 'florales', 'flores', 'flor'],
            s: ['rosa', 'rosas', 'peonía', 'peonías', 'girasol', 'girasoles', 'lirio', 'lirios', 'margarita', 'margaritas', 'tulipán', 'orquídea', 'amapola', 'lavanda', 'ramo', 'jazmín', 'dalia', 'hibisco'],
            h: ['jardín', 'primavera', 'hojas', 'mariposa', 'colibrí'],
            w: ['femenino', 'naturaleza']
        },
        fineline_botanico: {
            n: ['fineline botánico', 'botánico fino'],
            s: ['ramita', 'ramitas', 'flor fina', 'flores finas', 'tallo'],
            h: ['lavanda', 'eucalipto', 'hojas', 'planta', 'ramo', 'flor', 'flores'],
            w: ['delicado', 'delicada', 'fino', 'fina', 'sutil']
        },
        biomecanico: {
            n: ['biomecánico', 'biomecánica', 'biomechanical', 'biomech'],
            s: ['engranaje', 'engranajes', 'pistón', 'mecánico', 'máquina', 'robot', 'cyborg', 'giger', 'cables', 'tuercas'],
            h: ['piel rasgada', 'robótico', 'terminator', 'acero', 'metal', 'alien'],
            w: ['futurista', '3d']
        },
        bioorganico: {
            n: ['bioorgánico', 'bioorgánica', 'bio orgánico', 'orgánico'],
            s: ['músculos', 'tendones', 'fibras', 'tejido', 'texturas orgánicas', 'alienígena'],
            h: ['piel rasgada', 'raíces', 'huesos', 'anatomía', 'giger'],
            w: ['oscuro', 'fluido']
        },
        horror: {
            n: ['horror', 'terror'],
            s: ['zombie', 'zombi', 'monstruo', 'película de terror', 'payaso asesino', 'sangre', 'sangriento', 'freddy', 'jason', 'pennywise', 'chucky', 'exorcista', 'vampiro', 'hombre lobo', 'gore'],
            h: ['demonio', 'calavera', 'cráneo', 'fantasma', 'muerte', 'parca', 'cementerio', 'bruja', 'araña'],
            w: ['oscuro', 'miedo', 'macabro']
        },
        dark_art: {
            n: ['dark art', 'arte oscuro', 'darkart'],
            s: ['macabro', 'ocultismo', 'satánico', 'baphomet', 'lucifer', 'ritual', 'pentagrama'],
            h: ['demonio', 'parca', 'muerte', 'calavera', 'cráneo', 'cuervo', 'bruja', 'cabra', 'polilla', 'cementerio'],
            w: ['oscuro', 'negro', 'siniestro']
        },
        glitch: {
            n: ['glitch'],
            s: ['distorsión', 'distorsionado', 'error digital', 'pixelado', 'interferencia', 'vhs', 'desfasado'],
            h: ['digital', 'cyberpunk'],
            w: ['futurista', 'moderno', 'tecnología']
        },
        pixel_art: {
            n: ['pixel art', 'pixelart', 'pixel', 'píxeles', '8 bit', '8bit', '16 bit'],
            s: ['mario', 'zelda', 'tetris', 'pac man', 'pacman', 'minecraft', 'arcade', 'game boy', 'gameboy', 'space invaders'],
            h: ['videojuego', 'videojuegos', 'gamer', 'consola'],
            w: ['retro']
        },
        graffiti: {
            n: ['graffiti', 'grafiti', 'grafitti'],
            s: ['spray', 'aerosol', 'wildstyle', 'street art', 'arte urbano', 'muro'],
            h: ['urbano', 'hip hop', 'rap', 'calle'],
            w: ['colorido', 'letras']
        },
        pop_art: {
            n: ['pop art', 'popart'],
            s: ['cómic', 'cómics', 'historieta', 'warhol', 'lichtenstein', 'viñeta', 'onomatopeya', 'marilyn', 'superhéroe'],
            h: ['labios', 'colores vivos', 'marvel'],
            w: ['colorido', 'retro']
        },
        art_nouveau: {
            n: ['art nouveau', 'nouveau', 'modernismo'],
            s: ['mucha', 'alphonse mucha', 'líneas orgánicas', 'mujer con flores', 'marco ornamental', 'vitral'],
            h: ['cabello largo', 'ornamentos'],
            w: ['vintage', 'curvas', 'decorativo', 'elegante']
        },
        art_deco: {
            n: ['art deco', 'art déco'],
            s: ['gatsby', 'años 20', 'geometría elegante', 'abanico', 'rayos de sol', 'chrysler'],
            h: ['arquitectura', 'lujo', 'dorado'],
            w: ['vintage', 'elegante', 'simétrico']
        },
        barroco: {
            n: ['barroco', 'barroca', 'baroque', 'rococó'],
            s: ['marco barroco', 'querubín', 'angelitos', 'ornamentos dorados', 'espejo antiguo'],
            h: ['estatua', 'escultura', 'catedral', 'corona', 'filigrana'],
            w: ['elegante', 'recargado', 'clásico']
        },
        abstract_brush: {
            n: ['abstract brush', 'brushstroke', 'brush stroke', 'pincelada', 'pinceladas'],
            s: ['brochazo', 'brochazos', 'trazo de pincel', 'tinta china', 'sumi e', 'sumi', 'mancha de tinta'],
            h: ['expresivo', 'movimiento'],
            w: ['libre', 'artístico', 'abstracto']
        },
        patchwork: {
            n: ['patchwork', 'patch work', 'parches'],
            s: ['varios tatuajes pequeños', 'tatuajes sueltos', 'colección de tatuajes', 'flash', 'stickers', 'sticker', 'piezas sueltas'],
            h: ['varios', 'relleno'],
            w: ['colección', 'mezcla']
        },
        religious_sacro: {
            n: ['religioso', 'religiosa', 'sacro', 'sagrado', 'religious'],
            s: ['virgen', 'cristo', 'jesús', 'jesucristo', 'cruz', 'crucifijo', 'rosario', 'sagrado corazón', 'santo', 'santa', 'san miguel', 'arcángel', 'biblia', 'versículo', 'salmo', 'dios', 'manos rezando'],
            h: ['ángel', 'paloma', 'oración', 'iglesia', 'catedral', 'fe'],
            w: ['bendición', 'protección', 'espiritual']
        },
        ornamental_blackwork: {
            n: ['ornamental blackwork', 'blackwork ornamental'],
            s: ['ornamento negro', 'patrón negro', 'mandala negro', 'encaje negro'],
            h: ['manga ornamental'],
            w: ['ornamental', 'blackwork', 'simétrico', 'patrón']
        },
        pointillism: {
            n: ['pointillism', 'puntillismo', 'puntillista'],
            s: ['hecho de puntos', 'sombreado con puntos', 'stippling'],
            h: ['puntos', 'punteado'],
            w: ['textura', 'degradado']
        },
        freehand: {
            n: ['freehand', 'free hand'],
            s: ['directo en la piel', 'sin stencil', 'sin plantilla', 'fluye con el cuerpo', 'adaptado al cuerpo'],
            h: ['orgánico', 'flujo'],
            w: ['libre', 'único']
        },
        cybersigilismo: {
            n: ['cybersigilismo', 'cibersigilismo', 'cybersigilism', 'cyber sigilism', 'sigilismo'],
            s: ['sigilo', 'sigilos', 'espinas', 'líneas afiladas', 'y2k', 'chrome'],
            h: ['tribal moderno', 'cyber', 'futurista'],
            w: ['afilado', 'moderno']
        },
        neotribal: {
            n: ['neotribal', 'neo tribal'],
            s: ['tribal moderno', 'tribal afilado'],
            h: ['espinas', 'y2k'],
            w: ['afilado', 'negro']
        }
    };

    // Índices de palabras clave: por clave exacta del estilo ("finelinebotanico")
    // y, como respaldo, por su clave canónica (para los alias del catálogo:
    // "Freehand Abstract" → freehand). Cada entrada: { text, norm, type, weight }.
    var KEYWORD_INDEX = (function () {
        var exact = {};
        var canonical = {};
        Object.keys(STYLE_KEYWORDS).forEach(function (value) {
            var entry = STYLE_KEYWORDS[value];
            var list = [];
            [['n', 'name'], ['s', 'strong'], ['h', 'hint'], ['w', 'weak']].forEach(function (pair) {
                (entry[pair[0]] || []).forEach(function (keyword) {
                    var norm = normalizeWords(keyword);
                    if (norm) list.push({ text: keyword, norm: norm, type: pair[1], weight: WEIGHTS[pair[1]] });
                });
            });
            exact[compactKey(value)] = list;
            if (!canonical[canonicalKey(value)]) canonical[canonicalKey(value)] = list;
        });
        return { exact: exact, canonical: canonical };
    }());

    // Palabras clave de un estilo del catálogo ({ name, slug }) o null.
    function keywordsFor(style) {
        if (!style) return null;
        var labels = [style.name, style.slug, style.value].filter(Boolean);
        var i;
        for (i = 0; i < labels.length; i++) {
            if (KEYWORD_INDEX.exact[compactKey(labels[i])]) return KEYWORD_INDEX.exact[compactKey(labels[i])];
        }
        for (i = 0; i < labels.length; i++) {
            if (KEYWORD_INDEX.canonical[canonicalKey(labels[i])]) return KEYWORD_INDEX.canonical[canonicalKey(labels[i])];
        }
        return null;
    }

    // Forma en que la frase aparece como palabra(s) completa(s), o '' si no
    // está. Tolera plural simple ("flor" encuentra "flores").
    function matchedForm(padded, phrase) {
        if (padded.indexOf(' ' + phrase + ' ') !== -1) return phrase;
        if (padded.indexOf(' ' + phrase + 's ') !== -1) return phrase + 's';
        if (padded.indexOf(' ' + phrase + 'es ') !== -1) return phrase + 'es';
        return '';
    }

    function containsPhrase(padded, phrase) {
        return matchedForm(padded, phrase) !== '';
    }

    function maskPhrase(padded, phrase) {
        var blank = ' ' + phrase.replace(/[a-z0-9]/g, '#') + ' ';
        return padded.split(' ' + phrase + ' ').join(blank)
            .split(' ' + phrase + 's ').join(blank)
            .split(' ' + phrase + 'es ').join(blank);
    }

    function clampLimit(limit) {
        var n = parseInt(limit, 10);
        if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
        return Math.min(MAX_LIMIT, n);
    }

    /**
     * Estilos sugeridos para una idea escrita por el cliente.
     * @param {string} idea
     * @param {Array<{id,slug,name}>} catalog  estilos raíz (tattoo_styles)
     * @param {{limit?:number}} [options]
     * @returns {Array<{style:object, score:number, matches:string[]}>}
     */
    function suggestStylesForIdea(idea, catalog, options) {
        var words = normalizeWords(String(idea || '').slice(0, MAX_IDEA_LENGTH));
        var styles = Array.isArray(catalog) && catalog.length ? catalog : STATIC_CATALOG;
        if (!words) return [];
        var padded = ' ' + words + ' ';

        var scores = styles.map(function (style, order) {
            return { style: style, order: order, score: 0, matches: [], keywords: keywordsFor(style) || [] };
        });

        // 1) Estilos nombrados: la frase más larga gana y se "consume" para que
        //    "neo tradicional" no sume también a "tradicional".
        var named = [];
        scores.forEach(function (entry) {
            entry.keywords.forEach(function (keyword) {
                if (keyword.type === 'name') named.push({ entry: entry, keyword: keyword });
            });
        });
        named.sort(function (a, b) { return b.keyword.norm.length - a.keyword.norm.length; });
        var remaining = padded;
        var consumed = {};
        named.forEach(function (item) {
            var norm = item.keyword.norm;
            if (!consumed[norm]) {
                if (!containsPhrase(remaining, norm)) return;
                consumed[norm] = true;
                remaining = maskPhrase(remaining, norm);
            }
            // Un estilo suma una sola vez por haber sido nombrado.
            if (item.entry.named) return;
            item.entry.named = true;
            item.entry.score += item.keyword.weight;
            item.entry.matches.push(item.keyword.text);
        });

        // 2) Temas y señales: pueden sumar a varios estilos a la vez.
        scores.forEach(function (entry) {
            // "flor" y "flores" (o "rosa" y "rosas") son la misma señal: se
            // cuenta una sola vez la palabra que realmente está en la idea.
            var seen = {};
            entry.keywords.forEach(function (keyword) {
                if (keyword.type === 'name') return;
                var form = matchedForm(padded, keyword.norm);
                if (!form || seen[form]) return;
                seen[form] = true;
                entry.score += keyword.weight;
                entry.matches.push(keyword.text);
            });
        });

        return scores
            .filter(function (entry) { return entry.score >= MIN_SCORE; })
            .sort(function (a, b) { return b.score - a.score || a.order - b.order; })
            .slice(0, clampLimit(options && options.limit))
            .map(function (entry) { return { style: entry.style, score: entry.score, matches: entry.matches.slice(0, 4) }; });
    }

    // ---------- Estilos del artista ----------
    function toList(value) {
        if (value === null || value === undefined || value === '') return [];
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed.charAt(0) === '[') {
                try {
                    var parsed = JSON.parse(trimmed);
                    return Array.isArray(parsed) ? parsed : [trimmed];
                } catch (_) {
                    return [trimmed];
                }
            }
            return trimmed.split(',');
        }
        return [];
    }

    function cleanLabels(value) {
        return toList(value)
            .map(function (item) { return String(item === null || item === undefined ? '' : item).trim(); })
            .filter(Boolean)
            .slice(0, 60);
    }

    // ¿Una etiqueta del artista corresponde a este nombre del catálogo?
    function labelMatches(artistLabel, catalogLabel) {
        if (sameStyle(artistLabel, catalogLabel)) return true;
        // Etiqueta conocida con equivalencia propia: no se compara por palabras
        // ("Tradicional Japonés (Irezumi)" no es "Tradicional").
        if (CANONICAL[compactKey(artistLabel)]) return false;
        var wanted = tokens(catalogLabel);
        var have = tokens(artistLabel);
        if (!wanted.length || have.length <= wanted.length) return false;
        return wanted.every(function (word) { return word.length >= 4 && have.indexOf(word) !== -1; });
    }

    // Nombres con los que se reconoce un estilo raíz: el suyo y los de sus
    // subestilos ("Irezumi" → Japonés), salvo los subestilos que también
    // existen como estilo raíz ("Mandala" no convierte a nadie en Blackwork).
    function styleLabels(style, rootKeys) {
        var out = [style.name, style.slug];
        (Array.isArray(style.substyles) ? style.substyles : []).forEach(function (sub) {
            if (sub && sub.name && !rootKeys[canonicalKey(sub.name)]) out.push(sub.name);
        });
        return out.filter(Boolean);
    }

    /**
     * Estilos del catálogo que trabaja el artista.
     * @returns {Array<object>} estilos raíz del catálogo, en su orden
     */
    function matchArtistStyles(artistStyles, catalog) {
        var labels = cleanLabels(artistStyles);
        var styles = (Array.isArray(catalog) ? catalog : []).filter(Boolean);
        if (!labels.length) return [];
        var rootKeys = {};
        styles.forEach(function (style) { rootKeys[canonicalKey(style.name)] = true; });
        return styles.filter(function (style) {
            var candidates = styleLabels(style, rootKeys);
            return labels.some(function (label) {
                return candidates.some(function (candidate) { return labelMatches(label, candidate); });
            });
        });
    }

    /**
     * Orden y etiquetas de la grilla de estilos.
     * mode 'artist'      → primero los del artista (insignia "Artista").
     * mode 'recommended' → sin artista (o sin estilos cargados): primero los
     *                      sugeridos por la idea (etiqueta "Recomendado").
     * mode 'plain'       → catálogo tal cual.
     */
    function arrangeStyles(catalog, context) {
        var styles = Array.isArray(catalog) ? catalog.slice() : [];
        var ctx = context || {};
        var position = function (style) { return styles.indexOf(style); };
        var suggestions = suggestStylesForIdea(ctx.idea, styles, { limit: ctx.limit });
        var suggestedBy = function (style) {
            for (var i = 0; i < suggestions.length; i++) {
                if (suggestions[i].style === style) return suggestions[i];
            }
            return null;
        };
        var artistStyles = matchArtistStyles(ctx.artistStyles, styles);

        if (artistStyles.length) {
            var first = artistStyles.slice().sort(function (a, b) {
                var sa = suggestedBy(a);
                var sb = suggestedBy(b);
                return ((sb ? sb.score : 0) - (sa ? sa.score : 0)) || (position(a) - position(b));
            });
            return {
                mode: 'artist',
                artistCount: first.length,
                recommendedCount: 0,
                items: first.map(function (style) {
                    var hit = suggestedBy(style);
                    return { style: style, badge: 'artist', matches: hit ? hit.matches : [] };
                }).concat(styles.filter(function (style) { return artistStyles.indexOf(style) === -1; })
                    .map(function (style) { return { style: style, badge: null, matches: [] }; }))
            };
        }

        if (suggestions.length) {
            var recommended = suggestions.map(function (item) { return item.style; });
            return {
                mode: 'recommended',
                artistCount: 0,
                recommendedCount: recommended.length,
                items: suggestions.map(function (item) {
                    return { style: item.style, badge: 'recommended', matches: item.matches };
                }).concat(styles.filter(function (style) { return recommended.indexOf(style) === -1; })
                    .map(function (style) { return { style: style, badge: null, matches: [] }; }))
            };
        }

        return {
            mode: 'plain',
            artistCount: 0,
            recommendedCount: 0,
            items: styles.map(function (style) { return { style: style, badge: null, matches: [] }; })
        };
    }

    return {
        WEIGHTS: WEIGHTS,
        MIN_SCORE: MIN_SCORE,
        DEFAULT_LIMIT: DEFAULT_LIMIT,
        MAX_LIMIT: MAX_LIMIT,
        MAX_IDEA_LENGTH: MAX_IDEA_LENGTH,
        STATIC_CATALOG: STATIC_CATALOG,
        STYLE_KEYWORDS: STYLE_KEYWORDS,
        ALIAS_GROUPS: ALIAS_GROUPS,
        normalizeWords: normalizeWords,
        compactKey: compactKey,
        canonicalKey: canonicalKey,
        sameStyle: sameStyle,
        tokens: tokens,
        cleanLabels: cleanLabels,
        keywordsFor: keywordsFor,
        suggestStylesForIdea: suggestStylesForIdea,
        matchArtistStyles: matchArtistStyles,
        arrangeStyles: arrangeStyles
    };
}));
