/**
 * WE ÖTZI · Cotizador · Silueta corporal (datos del dibujo)
 * ----------------------------------------------------------
 * Figura humana de 8 cabezas, de frente y de espalda, dibujada como un SVG
 * propio: una <path> por parte individual (subparte de body_parts), con el
 * part_id real en data-part. Sin DOM ni red: solo geometría.
 *
 * Convenciones
 *   - Lienzo 200 x 462, eje de simetría en x = 100.
 *   - Las partes con lado se dibujan UNA vez, en la mitad izquierda del lienzo,
 *     y se espejan con MIRROR. El lado es anatómico (el de la persona): de
 *     frente, la mitad izquierda del lienzo es el lado DERECHO de la persona;
 *     de espalda es su lado IZQUIERDO.
 *   - `fallback` son las partes que se prueban, en orden, si `part` no existe
 *     en el catálogo: las subpartes que agrega la migración 20261116100000 y
 *     los ids del catálogo local de respaldo de config-manager.js.
 *
 * Navegador: window.WoQuotationBodyFigure · Node: require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoQuotationBodyFigure = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var VIEWBOX = '24 4 152 454';
    var MIRROR = 'matrix(-1 0 0 1 200 0)';
    var VIEWS = [
        { id: 'front', label: 'Frente' },
        { id: 'back', label: 'Espalda' }
    ];

    // Extremidades: iguales de frente y de espalda (cambia el nombre de la parte
    // en la pierna baja y el pie).
    var ARM = [
        { part: 'hombro', sided: true, d: 'M 72 81 C 63 79 54 84 52 95 C 51 103 50 111 49.5 119 L 66 113 C 67 104 69 92 72 81 Z' },
        { part: 'brazo_superior', sided: true, d: 'M 49.5 119 L 66 113 C 65 130 61 148 58 162 L 44 160 C 44.5 146 47 132 49.5 119 Z' },
        { part: 'codo', sided: true, d: 'M 44 160 L 58 162 C 57 168 56 174 55 180 L 41 176 C 42 170 43 165 44 160 Z' },
        { part: 'antebrazo', sided: true, d: 'M 41 176 L 55 180 C 53 198 49 216 46 232 L 36 229 C 35 212 37 192 41 176 Z' },
        { part: 'muneca', sided: true, d: 'M 36 229 L 46 232 L 45 241 L 35 238 Z' },
        { part: 'mano', sided: true, d: 'M 35 238 L 45 241 C 49 244 52 250 51 255 C 50 258 47 257 46 253 C 46 257 45 260 43 263 L 32 260 C 31 252 32 244 35 238 Z' },
        { part: 'dedos_mano', fallback: ['dedos'], sided: true, d: 'M 32 260 L 43 263 C 43 271 41 279 38 283 C 35 285 31 283 30 279 C 29 272 30 266 32 260 Z' }
    ];
    var KNEE = { part: 'rodilla', sided: true, d: 'M 72 302 L 93 302 C 93.5 314 93 326 92 336 L 74 336 C 71.5 326 71 314 72 302 Z' };
    var LOWER_LEG = 'M 74 336 L 92 336 C 96 352 94 384 89 410 L 78 410 C 72 388 67 358 74 336 Z';
    var ANKLE = { part: 'tobillo', sided: true, d: 'M 78 410 L 89 410 C 89 416 89 421 89.5 426 L 77 426 C 77.5 421 78 416 78 410 Z' };

    var FRONT = [
        { part: 'cuello', fallback: ['cuello_frente'], d: 'M 90 63 C 94 67 106 67 110 63 L 111 73 C 113 77 118 79 123 80 L 77 80 C 82 79 87 77 89 73 Z' },
        { part: 'craneo', d: 'M 80 36 C 77 19 87 9 100 9 C 113 9 123 19 120 36 C 114 31 86 31 80 36 Z' },
        { part: 'cara', fallback: ['rostro'], d: 'M 80 36 C 86 31 114 31 120 36 C 121 46 118 56 111 62 C 106 67 94 67 89 62 C 82 56 79 46 80 36 Z' },
        { part: 'clavicula', fallback: ['pecho'], sided: true, d: 'M 100 80 L 77 80 L 72 81 C 71 84 70.5 86.5 70 89 L 95 88 L 100 88 Z' },
        { part: 'esternon', d: 'M 95 88 L 105 88 L 105 124 L 95 124 Z' },
        { part: 'pecho', sided: true, d: 'M 95 88 L 70 89 C 69 97 67 105 66 113 Q 71 124 84 125 Q 91 126 95 124 Z' },
        { part: 'costillas', sided: true, d: 'M 66 113 Q 71 124 84 125 L 84 150 L 70 150 C 67 138 66 125 66 113 Z' },
        { part: 'abdomen', d: 'M 84 125 Q 91 126 95 124 L 105 124 Q 109 126 116 125 L 116 150 L 115 182 L 100 214 L 85 182 L 84 150 Z' },
        { part: 'costado', sided: true, d: 'M 70 150 L 84 150 L 85 182 L 70 182 C 73 172 74 160 70 150 Z' },
        { part: 'cadera', fallback: ['pelvis'], sided: true, d: 'M 70 182 L 85 182 L 100 214 L 100 226 C 90 218 76 206 66 196 C 67 191 68 186 70 182 Z' },
        { part: 'muslo', sided: true, d: 'M 66 196 C 76 206 90 218 100 226 L 99 232 C 98 255 95 280 93 302 L 72 302 C 69 280 62 245 63 216 C 63 208 64 201 66 196 Z' },
        KNEE,
        { part: 'espinilla', fallback: ['pantorrilla'], sided: true, d: LOWER_LEG },
        ANKLE,
        { part: 'pie', sided: true, d: 'M 77 426 L 89.5 426 C 91 431 92 437 92 442 L 70 442 C 70 436 73 430 77 426 Z' },
        { part: 'dedos_pie', sided: true, d: 'M 70 442 L 92 442 C 93 447 91 451 87 451 L 74 451 C 70 451 69 446 70 442 Z' }
    ].concat(ARM);

    var BACK = [
        { part: 'nuca', d: 'M 92 48 L 108 48 L 109 62 L 111 73 C 113 77 118 79 123 80 L 77 80 C 82 79 87 77 89 73 L 91 62 Z' },
        { part: 'craneo', d: 'M 79 36 C 77 19 87 9 100 9 C 113 9 123 19 121 36 L 111 38 C 111 42 110 46 108 48 L 92 48 C 90 46 89 42 89 38 Z' },
        { part: 'detras_oreja', fallback: ['oreja'], sided: true, d: 'M 79 36 L 89 38 C 89 42 90 46 92 48 L 91 62 C 85 58 79 49 79 36 Z' },
        { part: 'espalda_alta', d: 'M 96 80 L 77 80 L 72 81 C 70.5 89 68.5 98 67 106 L 96 106 Z M 104 80 L 123 80 L 128 81 C 129.5 89 131.5 98 133 106 L 104 106 Z' },
        { part: 'omoplato', sided: true, d: 'M 67 106 L 96 106 L 96 140 L 69 140 C 67 131 66 122 66 113 C 66.3 110.5 66.6 108 67 106 Z' },
        { part: 'espalda_media', fallback: ['espalda_alta'], d: 'M 69 140 L 96 140 L 96 160 L 72 160 C 71.5 153 70.5 146 69 140 Z M 131 140 L 104 140 L 104 160 L 128 160 C 128.5 153 129.5 146 131 140 Z' },
        { part: 'espalda_baja', d: 'M 72 160 L 96 160 L 96 190 L 68 190 C 68.5 187 69 184.5 70 182 C 72.5 174 73 167 72 160 Z M 128 160 L 104 160 L 104 190 L 132 190 C 131.5 187 131 184.5 130 182 C 127.5 174 127 167 128 160 Z' },
        { part: 'columna', d: 'M 96 80 L 104 80 L 104 190 L 96 190 Z' },
        { part: 'gluteo', sided: true, d: 'M 68 190 L 100 190 L 100 231 C 90 238 72 236 63 222 C 62.5 211 64 199 68 190 Z' },
        { part: 'muslo', sided: true, d: 'M 63 222 C 72 236 90 238 100 231 L 99 234 C 98 256 95 280 93 302 L 72 302 C 69 282 63 252 63 222 Z' },
        KNEE,
        { part: 'pantorrilla', sided: true, d: LOWER_LEG },
        ANKLE,
        { part: 'pie', sided: true, d: 'M 77 426 L 89.5 426 C 90.5 432 91 438 90 445 C 86 448 79 448 75 445 C 74 438 75 431 77 426 Z' }
    ].concat(ARM);

    // Detalle no interactivo (orejas): le da lectura humana a la cabeza.
    var DECOR = {
        front: ['M 80.5 38 C 76 36 75.5 47 80 50 Z', 'M 119.5 38 C 124 36 124.5 47 120 50 Z'],
        back: ['M 79.5 38 C 75 36 74.5 47 79 50 Z', 'M 120.5 38 C 125 36 125.5 47 121 50 Z']
    };

    var SOURCES = { front: FRONT, back: BACK };

    /**
     * Lista plana de formas de una vista, ya resueltas por lado.
     * `candidates` son los part_id a probar en orden (la parte y sus fallback).
     * @returns {Array<{view,part,candidates,side,d,transform}>}
     */
    function shapes(view) {
        var list = [];
        (SOURCES[view] || []).forEach(function (item) {
            var candidates = [item.part].concat(item.fallback || []);
            if (!item.sided) {
                list.push({ view: view, part: item.part, candidates: candidates, side: null, d: item.d, transform: null });
                return;
            }
            // Mitad izquierda del lienzo: derecha de la persona de frente,
            // izquierda de espalda.
            var drawn = view === 'front' ? 'right' : 'left';
            var mirrored = drawn === 'right' ? 'left' : 'right';
            list.push({ view: view, part: item.part, candidates: candidates, side: drawn, d: item.d, transform: null });
            list.push({ view: view, part: item.part, candidates: candidates, side: mirrored, d: item.d, transform: MIRROR });
        });
        return list;
    }

    function allShapes() {
        return shapes('front').concat(shapes('back'));
    }

    // part_id de todas las partes dibujadas (incluye los fallback).
    function drawnParts() {
        var seen = {};
        allShapes().forEach(function (s) {
            s.candidates.forEach(function (id) { seen[id] = true; });
        });
        return Object.keys(seen);
    }

    return {
        VIEWBOX: VIEWBOX,
        MIRROR: MIRROR,
        VIEWS: VIEWS,
        DECOR: DECOR,
        shapes: shapes,
        allShapes: allShapes,
        drawnParts: drawnParts
    };
}));
