// ================================================================
// WE OTZI - Invitaciones · globo con tierra rellena
// Figma 2007:5792 / 2007:5793 (archivo w3JA83CcP5ISKjyOu87mx1): la tierra
// es una superficie beige (#d8cfbd → token --figma-sand-border) sobre el
// océano blanco, no un mapa de puntos.
//
// Renderer WebGL propio (sin dependencias nuevas): un shader de pantalla
// completa invierte la proyección ortográfica de invitations-model.js
// (misma convención que COBE, así los marcadores DOM caen en su lugar) y
// muestrea una máscara de tierra equirectangular con interpolación B-spline
// cúbica, que redondea las costas en vez de mostrar los píxeles del raster.
//
// Geografía, en orden de preferencia:
//  1. Natural Earth 1:110m (TopoJSON con el formato de world-atlas,
//     objects.countries) — lo que dibuja el Figma: la tierra se rasteriza
//     una vez a una máscara equirectangular de 4096 × 2048 (≈0,09°/px, con
//     mipmaps) y las fronteras (arcos compartidos por dos países) se dibujan
//     como vectores en un canvas 2D encima, con ancho constante en pantalla.
//     El archivo NO está en el repo: sumarlo requiere aprobar la descarga
//     (ver reporte del área). Se carga con setGeography(topology).
//  2. Respaldo: PNG 1 bit de 256 × 128 (≈1,4° por píxel) copiado de COBE
//     2.0.1 (MIT, © Shu Ding — ya vendorizado en public/shared/vendor/cobe),
//     sin fronteras. La máscara de COBE marca como tierra todo el océano
//     Ártico (desde ~74°N fuera del Atlántico): se recorta a 73,5°N, salvo en
//     el sector de Groenlandia y Ellesmere, donde el corte sube con transición
//     suave (125°O→80°O y 20°O→5°O) hasta 83,6°N (límite de la tierra en
//     Natural Earth). Se pierden Svalbard y las islas rusas del Ártico. Además se suaviza más en latitudes altas para no dibujar
//     "peines" junto al polo.
//
// API: WoInvitationsGlobe.create(canvas, { landColor, rimColor, borderColor,
//        overlay, geography, onLost }) →
//      Promise<{ render(view), setGeography(topology), hasGeography(), destroy() } | null>
//      view = { phi, theta, scale, width, height, dpr }
//      overlay = canvas 2D (encima del WebGL) para las fronteras.
// ================================================================

(function (root) {
    'use strict';

    var LAND_MASK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAACAAQAAAADMzoqnAAAECklEQVR42u3VsW4jRRzH8d94gzfF4Q0VQaC4vBLTRTp0mze4ggfAPAE5XQEFsGNAVIjwBrmW7h7gJE+giKjyABTZE4g06LKJETdRJvtD65kdz6yduKABiW+TVfzRf2bXYxtcE/59YJCz6YdbgQF6ACSRrwYKYImmh5PbwOewlV3wlQNbAN6SEExjUOO+BU0aCSnxReHABUlK4YFQeJeUT3da8IIkZ6NGoSnFY5KsMoVzMKfECUnqxgPYRArarmUCndHwzIEaQEpg5xVdBXROl8mpAQx5dUgPiHoYAAkg5w3JABR06byGAVgcRGAz5bznj6phBQNRFwyqgdxebH6gshJAesWoFhgYpApAFoG8BIZ/fEhSox5jDjQXmV0Ar5XJfAIrALi3URVs09gHIL4XJCkLC5LH9JWiArABFCSrQjdgkBzRJ0WJeUOSNyQAfJJwUSWUBRlJQ8oGHATACGlBynnzy2kEYLNjrxouigD8BZcgOeVPqh12RtufaCN5wCPVDpvQ9lsIrqndsJtDcWqBCpf4hWN7OdWHBw58FwIaNOU/n1TpMW2DFaD48cmr4185T8NHkpUFX749pQPVdgRKC/DGoQPVeAEKv+WHvY8OOWNTPRp5kHuwSf8wzXtVBKR7YwEH9H3lQUaypUfSATOALyVNu5vZJW31Bnx98nkLfDUWJaz6ixvm+RIQRdl3kmRxxiaDoGnZW4CpPfkaQadlcPim1xOSvETQo7Lv75enVAXJ3xGUlony4KQBBWUM1NiDc6qhyS8RgQs18OCMMtPDaAUIyg0PZkRWDqs+wnKJBTDI1Js6BolegOsKmUxNDBAAKqQyMQmidhegBlLZ+wwKYdv5M/8x1khkb1cgKqP2H+MKyV5vS+whrE8DQDgAlUAoRBX056EElJCjJVACeJBZgNfVp+iCCm4RBWCgKsRxASSA9KgDhDtCiTuMyfHsKXzhC6wNAIjjWb8LKAOA2ctk3FmCOlgKFy8f1N0JJtgsxinYnVAHt4t3gPzZXSCTyCWCQmBT91QE3B5yarSN40dNHYPka4TlDhTUI8zLvl0JSL3vZn6DsCFZOeB2yROEpR68sECQQA++xIGCR2X7DwlEoLRgUrZrqlUg50S1uy43YqDcN6UFBVkhAjWiCV2Q0jgQPdplMKxvBXodcOfAwJYvgdL+1etA1YJJfBcZlQV7sO1i2gHoNiyxtQ5sBsCgWyoxCHiFFd2L5nUTCqMAqGUgsQ9f5kCcCiZgRYkMgMTd5WsB1rTzj0Em14BE4r+QxN1lCEsVur2PoF5Wbg8RJXR4djgvBgauhLywoEZQrt1KKRdVS4CdlJ8qafyP+9KIj/nE/d7kKwH9jgS72e9DV+kvfTWgct4ZyP8Byb8BPG7MaaIIkAQAAAAASUVORK5CYII=';
    var GLOBE_RADIUS = 0.8; // igual que invitations-model.js (GLOBE_RADIUS)
    var THRESHOLD = 0.45; // < 0,5 para no perder islas de un píxel al suavizar
    var SHARP = 0.5; // mezcla B-spline (0, costas redondas) ↔ Catmull-Rom (1, más detalle)
    var NORTH_LIMIT = 83.6; // Natural Earth: punta norte de Groenlandia
    var ARCTIC_CUT = 73.5; // fuera de Groenlandia, COBE ya es casquete desde ~74°N
    // Rampa del sector de Groenlandia y Ellesmere en u de la máscara (u = lon / 360 + 0,5).
    var GREENLAND_U = [-125, -80, -20, -5].map(function (lon) { return lon / 360 + 0.5; });
    var GEO_WIDTH = 4096; // ancho de la máscara rasterizada desde Natural Earth
    var RAD = Math.PI / 180;

    var VERTEX = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';

    var FRAGMENT = [
        '#ifdef GL_OES_standard_derivatives',
        '#extension GL_OES_standard_derivatives : enable',
        '#endif',
        'precision highp float;',
        'uniform vec2 uRes;',
        'uniform vec3 uView;',
        'uniform sampler2D uMask;',
        'uniform vec2 uMaskSize;',
        'uniform vec3 uLand;',
        'uniform vec3 uRim;',
        'uniform float uRimWidth;',
        'uniform float uThreshold;',
        'uniform float uSharp;',
        'uniform float uHiRes;',
        'uniform float uNorth;',
        'uniform float uArctic;',
        'uniform vec4 uGreenland;',
        'const float R = ' + GLOBE_RADIUS.toFixed(2) + ';',
        // B-spline cúbica con 4 lecturas bilineales (Sigg & Hadwiger, GPU Gems 2 cap. 20).
        'vec4 cubic(float v) {',
        '    vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;',
        '    vec4 s = n * n * n;',
        '    float x = s.x;',
        '    float y = s.y - 4.0 * s.x;',
        '    float z = s.z - 4.0 * s.y + 6.0 * s.x;',
        '    float w = 6.0 - x - y - z;',
        '    return vec4(x, y, z, w) * (1.0 / 6.0);',
        '}',
        'float maskAt(vec2 uv) {',
        '    vec2 inv = 1.0 / uMaskSize;',
        '    vec2 coords = uv * uMaskSize - 0.5;',
        '    vec2 f = fract(coords);',
        '    coords -= f;',
        '    vec4 xc = cubic(f.x);',
        '    vec4 yc = cubic(f.y);',
        '    vec4 c = coords.xxyy + vec2(-0.5, 1.5).xyxy;',
        '    vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);',
        '    vec4 o = (c + vec4(xc.yw, yc.yw) / s) * inv.xxyy;',
        '    float s0 = texture2D(uMask, o.xz).r;',
        '    float s1 = texture2D(uMask, o.yz).r;',
        '    float s2 = texture2D(uMask, o.xw).r;',
        '    float s3 = texture2D(uMask, o.yw).r;',
        '    float sx = s.x / (s.x + s.y);',
        '    float sy = s.z / (s.z + s.w);',
        '    return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);',
        '}',
        // Catmull-Rom (interpolante): conserva rasgos de un píxel (penínsulas, estrechos).
        'vec4 crw(float t) {',
        '    float t2 = t * t; float t3 = t2 * t;',
        '    return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);',
        '}',
        'float tap(vec2 base, float dx, float dy) {',
        '    return texture2D(uMask, (base + vec2(dx, dy) + 0.5) / uMaskSize).r;',
        '}',
        'float rowAt(vec2 base, float dy, vec4 w) {',
        '    return tap(base, -1.0, dy) * w.x + tap(base, 0.0, dy) * w.y + tap(base, 1.0, dy) * w.z + tap(base, 2.0, dy) * w.w;',
        '}',
        'float catmullAt(vec2 uv) {',
        '    vec2 coords = uv * uMaskSize - 0.5;',
        '    vec2 base = floor(coords);',
        '    vec2 f = coords - base;',
        '    vec4 wx = crw(f.x); vec4 wy = crw(f.y);',
        '    return rowAt(base, -1.0, wx) * wy.x + rowAt(base, 0.0, wx) * wy.y + rowAt(base, 1.0, wx) * wy.z + rowAt(base, 2.0, wx) * wy.w;',
        '}',
        'void main() {',
        '    vec2 frag = gl_FragCoord.xy;',
        '    float c = (frag.x / uRes.x * 2.0 - 1.0) * (uRes.x / uRes.y) / uView.z;',
        '    float s = (frag.y / uRes.y * 2.0 - 1.0) / uView.z;',
        '    float d = length(vec2(c, s));',
        '    float px = 2.0 / (uRes.y * uView.z);',
        '    float rimHalf = uRimWidth * 0.5 * px;',
        '    if (d > R + rimHalf + px) { gl_FragColor = vec4(0.0); return; }',
        '    float z = sqrt(max(R * R - d * d, 0.0));',
        '    float cp = cos(uView.x); float sp = sin(uView.x);',
        '    float ct = cos(uView.y); float st = sin(uView.y);',
        // Inversa (transpuesta) de la rotación de projectVector().
        '    vec3 t = c * vec3(cp, 0.0, sp) + s * vec3(sp * st, ct, -cp * st) + z * vec3(-sp * ct, st, cp * ct);',
        '    vec3 v = t / R;',
        '    float lat = asin(clamp(v.y, -1.0, 1.0));',
        '    float lon = atan(v.z, -v.x);',
        '    float u = fract(lon / 6.2831853 + 1.0);',
        '    vec2 uv = vec2(u, 0.5 - lat / 3.1415927);',
        '    float m;',
        '    float thr;',
        '    if (uHiRes > 0.5) {',
        // Natural Earth rasterizado (mipmaps): en el antimeridiano se usa la rama
        // de u sin salto para que la derivada no elija una mipmap borrosa.
        '#ifdef GL_OES_standard_derivatives',
        '        float u2 = fract(lon / 6.2831853 + 1.5) - 0.5;',
        '        if (fwidth(u2) < fwidth(u)) uv.x = u2;',
        '#endif',
        '        m = texture2D(uMask, uv).r;',
        '        thr = 0.5;',
        '    } else {',
        // Máscara de COBE: más suavizado en latitudes altas (los texels convergen
        // hacia el polo) y sin el casquete ártico que trae rellenado.
        '        float sharp = uSharp * (1.0 - smoothstep(0.87, 1.05, abs(lat)));',
        '        m = mix(maskAt(uv), catmullAt(uv), sharp);',
        '        float sector = smoothstep(uGreenland.x, uGreenland.y, u) * (1.0 - smoothstep(uGreenland.z, uGreenland.w, u));',
        '        float cap = mix(uArctic, uNorth, sector);',
        '        m *= 1.0 - smoothstep(cap - 0.012, cap, lat);',
        '        thr = uThreshold;',
        '    }',
        '#ifdef GL_OES_standard_derivatives',
        '    float aa = clamp(fwidth(m) * 0.75, 0.003, 0.25);',
        '#else',
        '    float aa = 0.04;',
        '#endif',
        '    float land = smoothstep(thr - aa, thr + aa, m);',
        '    float inside = 1.0 - smoothstep(R - px, R, d);',
        // Contorno de 1,6px centrado en el borde, igual que .ism-outline (SVG).
        '    float rim = 1.0 - smoothstep(rimHalf - px * 0.5, rimHalf + px * 0.5, abs(d - R));',
        '    float a = max(land * inside, rim);',
        '    vec3 color = mix(uLand, uRim, rim);',
        '    gl_FragColor = vec4(color * a, a);',
        '}',
    ].join('\n');

    function parseColor(value, fallback) {
        var text = String(value || '').trim();
        var hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hex) {
            var h = hex[1].length === 3 ? hex[1].split('').map(function (ch) { return ch + ch; }).join('') : hex[1];
            return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16) / 255; });
        }
        var rgb = text.match(/^rgba?\(([^)]+)\)$/i);
        if (rgb) {
            var parts = rgb[1].split(/[\s,\/]+/).filter(Boolean).slice(0, 3).map(Number);
            if (parts.length === 3 && parts.every(function (n) { return isFinite(n); })) return parts.map(function (n) { return n / 255; });
        }
        return fallback;
    }

    /* ---------------- Natural Earth (TopoJSON, sin dependencias) ---------------- */
    // Arcos con cuantización delta (transform) → [[lon, lat], …] por arco.
    function decodeArcs(topology) {
        var t = topology.transform;
        return topology.arcs.map(function (arc) {
            var x = 0;
            var y = 0;
            return arc.map(function (p) {
                if (!t) return [p[0], p[1]];
                x += p[0];
                y += p[1];
                return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
            });
        });
    }

    // Anillo de TopoJSON (índices de arco; ~i = arco i invertido) → puntos.
    function stitchRing(arcs, indexes) {
        var points = [];
        indexes.forEach(function (index, k) {
            var arc = index < 0 ? arcs[~index].slice().reverse() : arcs[index];
            if (!arc) return;
            // Cada arco empieza donde terminó el anterior: no repetir el punto.
            for (var i = k && points.length ? 1 : 0; i < arc.length; i++) points.push(arc[i]);
        });
        return points;
    }

    // { polygons: [[ring, …], …], borders: [[[lon, lat], …], …] }
    // borders = arcos compartidos por dos países distintos (como
    // topojson.mesh(topology, countries, (a, b) => a !== b)).
    function topologyGeography(topology, objectName) {
        if (!topology || topology.type !== 'Topology' || !Array.isArray(topology.arcs) || !topology.objects) return null;
        var object = topology.objects[objectName || 'countries'] || topology.objects.land
            || topology.objects[Object.keys(topology.objects)[0]];
        if (!object) return null;
        var arcs = decodeArcs(topology);
        var geometries = object.type === 'GeometryCollection' ? (object.geometries || []) : [object];
        var owners = [];
        var polygons = [];
        geometries.forEach(function (geometry, owner) {
            var list = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.type === 'MultiPolygon' ? geometry.arcs : [];
            (list || []).forEach(function (polygon) {
                var rings = (polygon || []).map(function (indexes) {
                    indexes.forEach(function (index) {
                        var arc = index < 0 ? ~index : index;
                        owners[arc] = owners[arc] || [];
                        if (owners[arc].indexOf(owner) === -1) owners[arc].push(owner);
                    });
                    return stitchRing(arcs, indexes);
                }).filter(function (ring) { return ring.length > 2; });
                if (rings.length) polygons.push(rings);
            });
        });
        var borders = [];
        owners.forEach(function (list, arc) { if (list && list.length > 1) borders.push(arcs[arc]); });
        return { polygons: polygons, borders: borders };
    }

    // Longitudes continuas (sin saltos de ±360° en el antimeridiano). Un anillo
    // que da la vuelta al mundo (Antártida) se cierra por el polo.
    function unwrapRing(ring) {
        var out = [];
        var offset = 0;
        var prev = null;
        var latSum = 0;
        ring.forEach(function (p) {
            if (prev !== null) {
                var delta = p[0] - prev;
                if (delta > 180) offset -= 360;
                else if (delta < -180) offset += 360;
            }
            prev = p[0];
            latSum += p[1];
            out.push([p[0] + offset, p[1]]);
        });
        if (out.length && Math.abs(out[out.length - 1][0] - out[0][0]) > 180) {
            var pole = latSum / out.length < 0 ? -90 : 90;
            out.push([out[out.length - 1][0], pole], [out[0][0], pole]);
        }
        return out;
    }

    // Mismo vector que latLngToVector() de invitations-model.js (convención COBE).
    function lonLatToVector(lon, lat) {
        var phi = lat * RAD;
        var theta = lon * RAD - Math.PI;
        var cosPhi = Math.cos(phi);
        return [-cosPhi * Math.cos(theta), Math.sin(phi), cosPhi * Math.sin(theta)];
    }

    // Igual que projectVector() de invitations-model.js → { x, y, front } en px CSS.
    function projectLonLat(lon, lat, view) {
        var v = lonLatToVector(lon, lat);
        return projectUnit(v[0], v[1], v[2], viewBasis(view), view);
    }

    function viewBasis(view) {
        return { cp: Math.cos(view.phi), sp: Math.sin(view.phi), ct: Math.cos(view.theta), st: Math.sin(view.theta) };
    }

    function projectUnit(x, y, z, b, view) {
        var k = GLOBE_RADIUS * view.scale * view.height / 2;
        var c = b.cp * x + b.sp * z;
        var s = b.sp * b.st * x + b.ct * y - b.cp * b.st * z;
        var d = -b.sp * b.ct * x + b.st * y + b.cp * b.ct * z;
        return { x: view.width / 2 + c * k, y: view.height / 2 - s * k, front: d >= 0 };
    }

    // Ancho de frontera medido en el Figma: ~0,5px a zoom 1,16 (5792) y ~0,9px a 2,6 (5793).
    function borderWidth(scale) {
        return Math.max(0.5, Math.min(1.2, 0.5 + 0.28 * (scale - 1.16)));
    }

    function rasterizeLand(polygons, width) {
        var height = width / 2;
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#fff';
        var kx = width / 360;
        var ky = height / 180;
        // Un solo path par-impar para todos los países: los bordes compartidos no
        // dejan costuras de antialiasing y los huecos (Lesoto en Sudáfrica) los
        // rellena el país que los ocupa.
        ctx.beginPath();
        polygons.forEach(function (rings) {
            rings.forEach(function (ring) {
                var points = unwrapRing(ring);
                // Copias a ±360° para cubrir lo que cruza el borde del raster.
                [-360, 0, 360].forEach(function (shift) {
                    points.forEach(function (p, i) {
                        var x = (p[0] + shift + 180) * kx;
                        var y = (90 - p[1]) * ky;
                        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
                    });
                    ctx.closePath();
                });
            });
        });
        ctx.fill('evenodd');
        return canvas;
    }

    function compile(gl, type, source) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            var log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('shader: ' + log);
        }
        return shader;
    }

    function loadMask() {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('No se pudo leer la máscara de tierra')); };
            img.src = LAND_MASK;
        });
    }

    async function create(canvas, options) {
        options = options || {};
        if (!canvas || typeof canvas.getContext !== 'function') return null;
        var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false })
            || canvas.getContext('experimental-webgl');
        if (!gl) return null;
        gl.getExtension('OES_standard_derivatives');
        var aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');

        var program = gl.createProgram();
        gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(program));

        var image = await loadMask();
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        // 256 × 128 es potencia de 2: REPEAT horizontal resuelve el antimeridiano.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        var buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        var loc = {
            pos: gl.getAttribLocation(program, 'aPos'),
            res: gl.getUniformLocation(program, 'uRes'),
            view: gl.getUniformLocation(program, 'uView'),
            mask: gl.getUniformLocation(program, 'uMask'),
            maskSize: gl.getUniformLocation(program, 'uMaskSize'),
            land: gl.getUniformLocation(program, 'uLand'),
            rim: gl.getUniformLocation(program, 'uRim'),
            rimWidth: gl.getUniformLocation(program, 'uRimWidth'),
            threshold: gl.getUniformLocation(program, 'uThreshold'),
            sharp: gl.getUniformLocation(program, 'uSharp'),
            hiRes: gl.getUniformLocation(program, 'uHiRes'),
            north: gl.getUniformLocation(program, 'uNorth'),
            arctic: gl.getUniformLocation(program, 'uArctic'),
            greenland: gl.getUniformLocation(program, 'uGreenland'),
        };
        var land = parseColor(options.landColor, [0.847, 0.816, 0.749]);
        var rim = parseColor(options.rimColor, [0.141, 0.129, 0.114]);
        var borderColor = String(options.borderColor || '').trim() || '#FFFFFF';
        var maskSize = [image.naturalWidth || 256, image.naturalHeight || 128];
        var geoTexture = null;
        var geoSize = null;
        var borders = null; // Float32Array por arco: x, y, z unitarios (convención COBE)
        var overlay = options.overlay && typeof options.overlay.getContext === 'function' ? options.overlay : null;
        var overlayCtx = overlay ? overlay.getContext('2d') : null;
        var lost = false;
        canvas.addEventListener('webglcontextlost', function (event) {
            event.preventDefault();
            lost = true;
            if (typeof options.onLost === 'function') options.onLost();
        });

        // Natural Earth: máscara de alta resolución + fronteras vectoriales.
        function setGeography(topology) {
            var geo = topologyGeography(topology);
            if (lost || !geo || !geo.polygons.length) return false;
            var max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
            var width = max >= GEO_WIDTH ? GEO_WIDTH : 2048;
            var raster = rasterizeLand(geo.polygons, width);
            var next = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, next);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, raster);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            if (aniso) {
                var maxAniso = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
                gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
            }
            gl.generateMipmap(gl.TEXTURE_2D);
            if (geoTexture) gl.deleteTexture(geoTexture);
            geoTexture = next;
            geoSize = [width, width / 2];
            borders = geo.borders.map(function (arc) {
                var out = new Float32Array(arc.length * 3);
                arc.forEach(function (p, i) {
                    var v = lonLatToVector(p[0], p[1]);
                    out[i * 3] = v[0];
                    out[i * 3 + 1] = v[1];
                    out[i * 3 + 2] = v[2];
                });
                return out;
            });
            return true;
        }

        function drawBorders(view, dpr) {
            if (!overlayCtx) return;
            var w = Math.max(1, Math.round(view.width * dpr));
            var h = Math.max(1, Math.round(view.height * dpr));
            if (overlay.width !== w) overlay.width = w;
            if (overlay.height !== h) overlay.height = h;
            overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
            overlayCtx.clearRect(0, 0, w, h);
            if (!borders || !borders.length) return;
            overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            var b = viewBasis(view);
            overlayCtx.beginPath();
            borders.forEach(function (arc) {
                var drawing = false;
                for (var i = 0; i < arc.length; i += 3) {
                    var p = projectUnit(arc[i], arc[i + 1], arc[i + 2], b, view);
                    if (!p.front) { drawing = false; continue; }
                    if (drawing) overlayCtx.lineTo(p.x, p.y); else overlayCtx.moveTo(p.x, p.y);
                    drawing = true;
                }
            });
            overlayCtx.lineWidth = borderWidth(view.scale);
            overlayCtx.lineJoin = 'round';
            overlayCtx.lineCap = 'round';
            overlayCtx.strokeStyle = borderColor;
            overlayCtx.stroke();
        }

        function render(view) {
            if (lost || !view) return;
            var dpr = view.dpr || 1;
            var w = Math.max(1, Math.round(view.width * dpr));
            var h = Math.max(1, Math.round(view.height * dpr));
            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;
            gl.viewport(0, 0, w, h);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(program);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.enableVertexAttribArray(loc.pos);
            gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, geoTexture || texture);
            gl.uniform1i(loc.mask, 0);
            gl.uniform2f(loc.res, w, h);
            gl.uniform3f(loc.view, view.phi, view.theta, view.scale);
            var size = geoTexture ? geoSize : maskSize;
            gl.uniform2f(loc.maskSize, size[0], size[1]);
            gl.uniform3fv(loc.land, land);
            gl.uniform3fv(loc.rim, rim);
            gl.uniform1f(loc.rimWidth, 1.6 * dpr);
            gl.uniform1f(loc.threshold, THRESHOLD);
            gl.uniform1f(loc.sharp, SHARP);
            gl.uniform1f(loc.hiRes, geoTexture ? 1 : 0);
            gl.uniform1f(loc.north, NORTH_LIMIT * RAD);
            gl.uniform1f(loc.arctic, ARCTIC_CUT * RAD);
            gl.uniform4f(loc.greenland, GREENLAND_U[0], GREENLAND_U[1], GREENLAND_U[2], GREENLAND_U[3]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            drawBorders(view, dpr);
        }

        function destroy() {
            try {
                gl.deleteTexture(texture);
                if (geoTexture) gl.deleteTexture(geoTexture);
                gl.deleteBuffer(buffer);
                gl.deleteProgram(program);
            } catch (_) { /* contexto perdido */ }
            if (overlayCtx) overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
        }

        if (options.geography) setGeography(options.geography);

        return {
            render: render,
            setGeography: setGeography,
            hasGeography: function () { return !!geoTexture; },
            destroy: destroy,
        };
    }

    var api = {
        create: create,
        parseColor: parseColor,
        THRESHOLD: THRESHOLD,
        NORTH_LIMIT: NORTH_LIMIT,
        ARCTIC_CUT: ARCTIC_CUT,
        decodeArcs: decodeArcs,
        stitchRing: stitchRing,
        topologyGeography: topologyGeography,
        unwrapRing: unwrapRing,
        projectLonLat: projectLonLat,
        borderWidth: borderWidth,
        rasterizeLand: rasterizeLand,
    };
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.WoInvitationsGlobe = api;
}(typeof self !== 'undefined' ? self : this));
