/**
 * WE OTZI - Invitaciones · lógica pura (sin DOM ni red)
 * -----------------------------------------------------
 * Figma final del flujo de artista (oct 2026), área invitaciones:
 *   801:540 listado · 801:541 detalle · 2007:5792/5793 mapa de estudios ·
 *   2007:5794 detalle de estudio ampliado · 2007:5795 escribir al estudio.
 *
 * Reúne los cálculos que comparten las vistas de /artist/invitations para
 * poder testearlos en Node: fechas cortas, oportunidades de un estudio
 * (guest spot / residencia), directorio del mapa, filtros, agrupación de
 * marcadores, proyección del globo (misma matemática que COBE 2.0.1) y
 * validación del formulario "Escribir al estudio".
 *
 * UMD: `window.WoInvitationsModel` en el navegador, `require` en Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoInvitationsModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    var DAY = 24 * 60 * 60 * 1000;
    var RAD = Math.PI / 180;
    // Radio de la esfera que dibuja COBE en coordenadas normalizadas.
    var GLOBE_RADIUS = 0.8;

    var REASONS = {
        guest_spot: 'Guest spot',
        resident: 'Artista residente',
        other: 'Otra consulta'
    };
    var MESSAGE_MIN = 20;
    var MESSAGE_MAX = 2000;

    /* ------------------------------ texto ------------------------------ */
    function text(value) { return value == null ? '' : String(value).trim(); }

    function normalize(value) {
        return text(value).toLocaleLowerCase('es')
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    function initials(name) {
        var parts = text(name).split(/\s+/).filter(Boolean);
        var letters = parts.length > 1
            ? parts.slice(0, 2).map(function (part) { return part.charAt(0); }).join('')
            : (parts[0] || '').slice(0, 2);
        return letters.toUpperCase() || 'WO';
    }

    function toList(value) {
        if (Array.isArray(value)) return value.map(text).filter(Boolean);
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (!trimmed) return [];
            if (trimmed.charAt(0) === '[') {
                try { return toList(JSON.parse(trimmed)); } catch (_) { /* texto plano */ }
            }
            return trimmed.split(/[,|]/).map(text).filter(Boolean);
        }
        return [];
    }

    function numberOrNull(value) {
        if (value === '' || value == null) return null;
        var number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    /* ------------------------------ fechas ------------------------------ */
    function parseDate(value) {
        if (!value) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        var raw = String(value);
        var date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + 'T12:00:00' : raw);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    // "08 jul"
    function shortDate(value) {
        var date = parseDate(value);
        if (!date) return '';
        return pad2(date.getDate()) + ' ' + MONTHS_SHORT[date.getMonth()];
    }

    // "3 de agosto, 2026"
    function longDate(value) {
        var date = parseDate(value);
        if (!date) return '';
        return date.getDate() + ' de ' + MONTHS[date.getMonth()] + ', ' + date.getFullYear();
    }

    // "1 de agosto"
    function dayMonth(value) {
        var date = parseDate(value);
        if (!date) return '';
        return date.getDate() + ' de ' + MONTHS[date.getMonth()];
    }

    // "28 sep – 11 oct" (sin cero inicial, como el Figma)
    function rangeLabel(start, end) {
        var a = parseDate(start);
        var b = parseDate(end);
        function fmt(d) { return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()]; }
        if (a && b) return fmt(a) + ' – ' + fmt(b);
        if (a) return 'Desde el ' + fmt(a);
        if (b) return 'Hasta el ' + fmt(b);
        return '';
    }

    function startOfDay(date) {
        var d = new Date(date.getTime());
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // "hoy" · "ayer" · "el 08 JUL"
    function relativeDay(value, now) {
        var date = parseDate(value);
        if (!date) return '';
        var today = startOfDay(now || new Date());
        var diff = Math.round((today.getTime() - startOfDay(date).getTime()) / DAY);
        if (diff === 0) return 'hoy';
        if (diff === 1) return 'ayer';
        return 'el ' + shortDate(date).toUpperCase();
    }

    function isoDate(date) {
        return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    }

    /* --------------------------- invitaciones --------------------------- */
    var STATE_LABELS = { pending: 'pendiente', active: 'aceptada', rejected: 'rechazada', ended: 'finalizada' };

    function membershipState(membership) {
        var status = text(membership && (membership._state || membership.status));
        if (status === 'pending_invite' || status === 'pending_acceptance' || status === 'pending') return 'pending';
        if (status === 'active' || status === 'paused') return 'active';
        if (status === 'rejected') return 'rejected';
        if (status === 'ended') return 'ended';
        return status || 'pending';
    }

    // "Te invitó el 08 JUL · aceptada." (mapa) / "Te invitó el 08 JUL · la aceptaste" (detalle)
    function invitationLine(membership, variant) {
        if (!membership) return '';
        var state = membershipState(membership);
        var when = shortDate(membership.invited_at || membership.created_at).toUpperCase();
        var head = when ? 'Te invitó el ' + when : 'Te invitó';
        if (variant === 'detail') {
            var verbs = { pending: 'esperando tu respuesta', active: 'la aceptaste', rejected: 'la rechazaste', ended: 'finalizada' };
            return head + ' · ' + (verbs[state] || STATE_LABELS[state] || '');
        }
        return head + ' · ' + (STATE_LABELS[state] || state) + '.';
    }

    /* ---------------------------- contactos ---------------------------- */
    function reasonLabel(reason) { return REASONS[reason] || REASONS.other; }

    function contactContext(thread) {
        var ctx = thread && thread.context;
        if (typeof ctx === 'string') {
            try { ctx = JSON.parse(ctx); } catch (_) { ctx = {}; }
        }
        return ctx && typeof ctx === 'object' ? ctx : {};
    }

    function contactStudioId(thread) {
        var ctx = contactContext(thread);
        return text(thread && thread.context_id) || text(ctx.studio_id);
    }

    function contactWhen(thread) {
        var ctx = contactContext(thread);
        return ctx.last_contact_at || (thread && (thread.last_message_at || thread.created_at)) || null;
    }

    // { day: 'hoy', reason: 'Guest spot', sentence: 'Le escribiste hoy.', summary: 'Le escribiste hoy · Guest spot' }
    function contactSummary(thread, now) {
        if (!thread) return null;
        var ctx = contactContext(thread);
        var day = relativeDay(contactWhen(thread), now);
        var reason = ctx.reason_label || (ctx.reason ? reasonLabel(ctx.reason) : '');
        var sentence = 'Le escribiste' + (day ? ' ' + day : '') + '.';
        return {
            threadId: thread.id || null,
            day: day,
            reason: reason,
            sentence: sentence,
            summary: 'Le escribiste' + (day ? ' ' + day : '') + (reason ? ' · ' + reason : '')
        };
    }

    function contactsByStudio(threads) {
        var map = {};
        (threads || []).forEach(function (thread) {
            if (!thread || thread.context_type !== 'studio_contact') return;
            var id = contactStudioId(thread);
            if (!id) return;
            var current = map[id];
            if (!current || dateValue(contactWhen(thread)) > dateValue(contactWhen(current))) map[id] = thread;
        });
        return map;
    }

    function dateValue(value) {
        var date = parseDate(value);
        return date ? date.getTime() : 0;
    }

    /* --------------------------- oportunidades --------------------------- */
    // Split guardado como % para el artista → "Comisión 50/50" (estudio/artista).
    function splitLabel(artistPct) {
        var pct = numberOrNull(artistPct);
        if (pct == null) return '';
        var artist = Math.round(pct);
        return 'Comisión ' + (100 - artist) + '/' + artist;
    }

    function opportunitiesFor(studio, spots, now) {
        studio = studio || {};
        var today = startOfDay(now || new Date()).getTime();
        var open = (spots || []).filter(function (spot) {
            return spot && (!spot.status || spot.status === 'open')
                && (!spot.studio_id || !studio.id || String(spot.studio_id) === String(studio.id));
        });
        var guestSpots = open.filter(function (spot) { return spot.kind === 'guest_spot' || spot.kind === 'itinerant'; })
            .filter(function (spot) { var end = parseDate(spot.end_date); return !end || end.getTime() >= today; })
            .sort(function (a, b) { return dateValue(a.start_date) - dateValue(b.start_date); });
        var residentSpots = open.filter(function (spot) { return spot.kind === 'resident'; });
        var guestWindowEnd = parseDate(studio.guest_window_end);
        var studioWindow = studio.guest_window_start && (!guestWindowEnd || guestWindowEnd.getTime() >= today)
            ? { start: studio.guest_window_start, end: studio.guest_window_end } : null;
        var guestStart = guestSpots[0] ? guestSpots[0].start_date : (studioWindow && studioWindow.start);
        var guestEnd = guestSpots[0] ? guestSpots[0].end_date : (studioWindow && studioWindow.end);
        var guest = guestSpots.length > 0 || studio.accepts_guest_spots === true || !!studioWindow;
        var resident = residentSpots.length > 0 || studio.is_seeking_artists === true;
        var residentSplit = residentSpots.map(function (s) { return numberOrNull(s.revenue_split_pct); })
            .filter(function (n) { return n != null; })[0];
        var split = residentSplit != null ? residentSplit : numberOrNull(studio.default_revenue_split_pct);
        var requirements = toList(studio.artist_requirements);
        if (!requirements.length) {
            open.some(function (spot) { requirements = toList(spot.minimum_requirements); return requirements.length > 0; });
        }
        var labels = [];
        if (guest && resident) labels.push('Guest spots y artistas residentes');
        else if (guest) labels.push('Guest spots');
        else if (resident) labels.push('Artistas residentes');
        return {
            guest: { open: guest, start: guestStart || null, end: guestEnd || null, dates: rangeLabel(guestStart, guestEnd) },
            resident: { open: resident, splitPct: split == null ? null : split, split: splitLabel(split) },
            kinds: [guest ? 'guest_spot' : null, resident ? 'resident' : null].filter(Boolean),
            summary: labels[0] || '',
            requirements: requirements
        };
    }

    /* ---------------------------- directorio ---------------------------- */
    function studioPhotos(studio) {
        studio = studio || {};
        var feed = Array.isArray(studio.photo_feed_items) ? studio.photo_feed_items : [];
        var values = [studio.cover_image].concat(feed.map(function (item) {
            return typeof item === 'string' ? item : (item && (item.url || item.image_url || item.src)) || '';
        }));
        var seen = {};
        return values.filter(function (url) {
            if (!url || seen[url]) return false;
            seen[url] = true;
            return true;
        });
    }

    function studioStyles(studio, roster) {
        var own = toList(studio && (studio.specialty_styles || studio.styles));
        if (own.length) return own;
        var seen = {};
        var out = [];
        (roster || []).forEach(function (artist) {
            toList(artist && artist.styles_array).slice(0, 1).forEach(function (style) {
                var key = normalize(style);
                if (!seen[key]) { seen[key] = true; out.push(style); }
            });
        });
        return out.slice(0, 4);
    }

    // Une sedes geolocalizadas + estudio embebido + spots + invitaciones + contactos.
    function buildDirectory(input, now) {
        input = input || {};
        var spotsByStudio = {};
        (input.spots || []).forEach(function (spot) {
            var key = String(spot.studio_id);
            (spotsByStudio[key] = spotsByStudio[key] || []).push(spot);
        });
        var membershipByStudio = {};
        (input.memberships || []).forEach(function (membership) {
            var studio = membership.studios || membership.studio || {};
            var key = String(studio.id || membership.studio_id || '');
            if (!key) return;
            var current = membershipByStudio[key];
            if (!current || dateValue(membership.invited_at) > dateValue(current.invited_at)) membershipByStudio[key] = membership;
        });
        var contacts = contactsByStudio(input.contacts);
        var seen = {};
        var out = [];
        (input.locations || []).forEach(function (location) {
            var studio = location.studios || location.studio || {};
            var id = String(studio.id || location.studio_id || '');
            var lat = numberOrNull(location.latitude != null ? location.latitude : studio.latitude);
            var lng = numberOrNull(location.longitude != null ? location.longitude : studio.longitude);
            if (!id || seen[id] || lat == null || lng == null) return;
            if (studio.is_active === false) return;
            seen[id] = true;
            var city = text(location.city || studio.city);
            var country = text(location.country || studio.country);
            out.push({
                id: id,
                slug: text(studio.slug),
                name: text(studio.name) || 'Estudio',
                initials: initials(studio.name),
                tagline: text(studio.tagline),
                bio: text(studio.bio),
                city: city,
                country: country,
                locality: text(location.locality || studio.locality),
                address: text(location.formatted_address || studio.formatted_address),
                lat: lat,
                lng: lng,
                photo: studioPhotos(studio)[0] || '',
                styles: studioStyles(studio),
                languages: toList(studio.languages),
                hasAccount: studio.user_id === undefined ? true : !!studio.user_id,
                acceptsInquiries: studio.accepts_artist_inquiries !== false,
                opportunities: opportunitiesFor(studio, spotsByStudio[id], now),
                membership: membershipByStudio[id] || null,
                contact: contacts[id] || null,
                studio: studio
            });
        });
        return out.sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });
    }

    function filterDirectory(list, filters) {
        filters = filters || {};
        var query = normalize(filters.query);
        var country = text(filters.country);
        var kind = text(filters.kind) || 'all';
        return (list || []).filter(function (studio) {
            if (country && studio.country !== country) return false;
            if (kind !== 'all' && studio.opportunities.kinds.indexOf(kind) === -1) return false;
            if (!query) return true;
            return [studio.name, studio.city, studio.country, studio.locality].some(function (value) {
                return normalize(value).indexOf(query) !== -1;
            });
        });
    }

    function countries(list) {
        var seen = {};
        (list || []).forEach(function (studio) { if (studio.country) seen[studio.country] = true; });
        return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'es'); });
    }

    /* ------------------------------- globo ------------------------------- */
    // Misma convención que COBE 2.0.1 (ver explore-globe.js).
    function latLngToVector(lat, lng) {
        var phi = lat * RAD;
        var theta = lng * RAD - Math.PI;
        var cosPhi = Math.cos(phi);
        return [-cosPhi * Math.cos(theta), Math.sin(phi), cosPhi * Math.sin(theta)];
    }

    // view = { phi, theta, scale, width, height }
    function projectVector(vector, view, radius) {
        var r = radius == null ? GLOBE_RADIUS : radius;
        var tx = vector[0] * r, ty = vector[1] * r, tz = vector[2] * r;
        var cosTheta = Math.cos(view.theta), sinTheta = Math.sin(view.theta);
        var cosPhi = Math.cos(view.phi), sinPhi = Math.sin(view.phi);
        var c = cosPhi * tx + sinPhi * tz;
        var s = sinPhi * sinTheta * tx + cosTheta * ty - cosPhi * sinTheta * tz;
        var z = -sinPhi * cosTheta * tx + sinTheta * ty + cosPhi * cosTheta * tz;
        var w = view.width || 1;
        var h = view.height || 1;
        var ndcX = c / (w / h) * view.scale;
        var ndcY = -s * view.scale;
        return { x: (ndcX + 1) * 0.5 * w, y: (ndcY + 1) * 0.5 * h, z: z, front: z >= 0 };
    }

    function project(lat, lng, view) { return projectVector(latLngToVector(lat, lng), view); }

    // Ángulos para dejar (lat, lng) al frente del globo.
    function focusAngles(lat, lng) {
        return { phi: -Math.PI / 2 - lng * RAD, theta: lat * RAD };
    }

    // Ángulo equivalente a `target` más cercano a `current` (giro corto).
    function nearestAngle(current, target) {
        var twoPi = Math.PI * 2;
        var delta = ((target - current) % twoPi + twoPi * 1.5) % twoPi - Math.PI;
        return current + delta;
    }

    function globeCircle(view) {
        return { cx: view.width / 2, cy: view.height / 2, r: GLOBE_RADIUS * view.height / 2 * view.scale };
    }

    // Paths SVG de la retícula (meridianos y paralelos) visibles al frente.
    function graticulePaths(view, step) {
        step = step || 15;
        var paths = [];
        function trace(points) {
            var d = '';
            var drawing = false;
            points.forEach(function (p) {
                var point = project(p[0], p[1], view);
                if (!point.front) { drawing = false; return; }
                d += (drawing ? 'L' : 'M') + point.x.toFixed(1) + ' ' + point.y.toFixed(1);
                drawing = true;
            });
            if (d) paths.push(d);
        }
        var lng, lat, pts, limit;
        for (lng = -180; lng < 180; lng += step) {
            pts = [];
            // Como d3.geoGraticule10: los meridianos mayores (cada 90°) llegan al
            // polo; los demás terminan en el último paralelo.
            limit = lng % 90 === 0 ? 90 : 90 - step;
            for (lat = -limit; lat < limit; lat += 3) pts.push([lat, lng]);
            pts.push([limit, lng]);
            trace(pts);
        }
        for (lat = -90 + step; lat < 90; lat += step) {
            pts = [];
            for (lng = -180; lng <= 180; lng += 3) pts.push([lat, lng]);
            trace(pts);
        }
        return paths;
    }

    // Agrupa puntos de pantalla cercanos. points: [{ id, x, y }] → [{ ids, x, y }]
    // minGap: distancia mínima entre centros de grupos resultantes. El paso
    // voraz mueve el centro de cada grupo al promediar, así que dos grupos
    // pueden terminar más cerca que `radius`; se fusionan hasta respetar minGap.
    function clusterPoints(points, radius, minGap) {
        var r2 = (radius || 26) * (radius || 26);
        var gap = minGap == null ? (radius || 26) : minGap;
        var g2 = gap * gap;
        var clusters = [];
        (points || []).forEach(function (point) {
            var hit = null;
            for (var i = 0; i < clusters.length; i++) {
                var dx = clusters[i].x - point.x;
                var dy = clusters[i].y - point.y;
                if (dx * dx + dy * dy <= r2) { hit = clusters[i]; break; }
            }
            if (hit) {
                hit.ids.push(point.id);
                hit.sx += point.x; hit.sy += point.y;
                hit.x = hit.sx / hit.ids.length;
                hit.y = hit.sy / hit.ids.length;
            } else {
                clusters.push({ ids: [point.id], x: point.x, y: point.y, sx: point.x, sy: point.y });
            }
        });
        var merged = true;
        while (merged && clusters.length > 1) {
            merged = false;
            for (var a = 0; a < clusters.length && !merged; a++) {
                for (var b = a + 1; b < clusters.length; b++) {
                    var mx = clusters[a].x - clusters[b].x;
                    var my = clusters[a].y - clusters[b].y;
                    if (mx * mx + my * my < g2) {
                        var keep = clusters[a];
                        var drop = clusters[b];
                        keep.ids = keep.ids.concat(drop.ids);
                        keep.sx += drop.sx; keep.sy += drop.sy;
                        keep.x = keep.sx / keep.ids.length;
                        keep.y = keep.sy / keep.ids.length;
                        clusters.splice(b, 1);
                        merged = true;
                        break;
                    }
                }
            }
        }
        return clusters.map(function (cluster) { return { ids: cluster.ids, x: cluster.x, y: cluster.y }; });
    }

    function centroid(studios) {
        // Promedio sobre la esfera para que el centro no salte de hemisferio.
        var sum = [0, 0, 0];
        (studios || []).forEach(function (studio) {
            var v = latLngToVector(studio.lat, studio.lng);
            sum[0] += v[0]; sum[1] += v[1]; sum[2] += v[2];
        });
        var len = Math.sqrt(sum[0] * sum[0] + sum[1] * sum[1] + sum[2] * sum[2]) || 1;
        var x = sum[0] / len, y = sum[1] / len, z = sum[2] / len;
        var lat = Math.asin(Math.max(-1, Math.min(1, y))) / RAD;
        // Inversa de latLngToVector: x = -cosφ·cosθ, z = cosφ·sinθ con θ = lng - π.
        var theta = Math.atan2(z, -x);
        var lng = theta / RAD + 180;
        if (lng > 180) lng -= 360;
        return { lat: lat, lng: lng };
    }

    /* ----------------------------- contacto ----------------------------- */
    function validateContact(form, now) {
        form = form || {};
        var errors = {};
        var message = text(form.message);
        if (!REASONS[form.reason]) errors.reason = 'Elegí un motivo.';
        if (message.length < MESSAGE_MIN) errors.message = 'Escribí al menos ' + MESSAGE_MIN + ' caracteres.';
        else if (message.length > MESSAGE_MAX) errors.message = 'El mensaje no puede superar los ' + MESSAGE_MAX + ' caracteres.';
        var start = text(form.startDate);
        var end = text(form.endDate);
        if (start || end) {
            var a = parseDate(start);
            var b = parseDate(end);
            var today = startOfDay(now || new Date());
            if (!a || !b) errors.dates = 'Completá las dos fechas o dejalas vacías.';
            else if (b.getTime() < a.getTime()) errors.dates = 'La fecha de fin tiene que ser posterior al inicio.';
            else if (startOfDay(a).getTime() < today.getTime()) errors.dates = 'Elegí fechas a partir de hoy.';
        }
        return { ok: Object.keys(errors).length === 0, errors: errors, message: message };
    }

    function characterCount(value) {
        var n = text(value).length;
        return n + (n === 1 ? ' carácter' : ' caracteres') + ' · mínimo ' + MESSAGE_MIN;
    }

    /* ------------------------------ listado ------------------------------ */
    // Nombre corto para el índice lateral (801:540 muestra "01 Fierro Negro",
    // "05 Tierra Firme"): quita un sufijo genérico final, nunca deja vacío.
    var GENERIC_SUFFIX = /\s+(?:tattoo\s+(?:studio|shop|club)|tattoos?|tatuajes|collective|colectivo|studio|shop)$/i;
    function shortStudioName(name) {
        var full = text(name);
        var short = full.replace(GENERIC_SUFFIX, '').trim();
        return short || full;
    }

    // Invitación del mes: se elige sobre el total (no sobre lo filtrado) para
    // que un filtro nunca promueva otra. La marcada como destacada manda; si no
    // hay, la pendiente más reciente.
    function featuredInvitation(items, isFeatured, dateOf) {
        var pending = (items || []).filter(function (item) { return item && item._state === 'pending'; })
            .sort(function (a, b) { return dateValue(dateOf(b)) - dateValue(dateOf(a)); });
        return pending.filter(function (item) { return isFeatured(item); })[0] || pending[0] || null;
    }

    // Índice lateral: la invitación del mes es 01 y el resto va por fecha,
    // de la más reciente a la más vieja (como el Figma: 12, 10, 08, 05, 02 jul).
    function indexOrder(items, featured, dateOf) {
        var rest = (items || []).filter(function (item) { return item !== featured; })
            .sort(function (a, b) { return dateValue(dateOf(b)) - dateValue(dateOf(a)); });
        return featured ? [featured].concat(rest) : rest;
    }

    // Listado. 'recent' (por defecto) = layout del Figma por bloques: invitación
    // del mes, roster, pendientes y rechazadas, cada bloque por fecha. Con otro
    // orden la lista es una sola, ordenada de punta a punta y sin tarjeta del mes.
    function listLayout(visible, options) {
        options = options || {};
        var dateOf = options.dateOf;
        var nameOf = options.nameOf || function (item) { return text(item && item.name); };
        var sortMode = options.sortMode || 'recent';
        var byRecent = function (a, b) { return dateValue(dateOf(b)) - dateValue(dateOf(a)); };
        var list = (visible || []).slice();
        if (sortMode === 'oldest') {
            return { feature: null, items: list.sort(function (a, b) { return dateValue(dateOf(a)) - dateValue(dateOf(b)); }) };
        }
        if (sortMode === 'studio') {
            return { feature: null, items: list.sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b), 'es') || byRecent(a, b); }) };
        }
        list.sort(byRecent);
        var feature = options.featured && list.indexOf(options.featured) !== -1 ? options.featured : null;
        var pick = function (stateName) { return list.filter(function (item) { return item._state === stateName && item !== feature; }); };
        return { feature: feature, items: pick('active').concat(pick('pending'), pick('rejected')) };
    }

    return {
        MONTHS: MONTHS,
        MONTHS_SHORT: MONTHS_SHORT,
        REASONS: REASONS,
        MESSAGE_MIN: MESSAGE_MIN,
        MESSAGE_MAX: MESSAGE_MAX,
        GLOBE_RADIUS: GLOBE_RADIUS,
        text: text,
        normalize: normalize,
        initials: initials,
        toList: toList,
        numberOrNull: numberOrNull,
        parseDate: parseDate,
        shortDate: shortDate,
        longDate: longDate,
        dayMonth: dayMonth,
        rangeLabel: rangeLabel,
        relativeDay: relativeDay,
        isoDate: isoDate,
        dateValue: dateValue,
        membershipState: membershipState,
        invitationLine: invitationLine,
        reasonLabel: reasonLabel,
        contactSummary: contactSummary,
        contactsByStudio: contactsByStudio,
        splitLabel: splitLabel,
        opportunitiesFor: opportunitiesFor,
        studioPhotos: studioPhotos,
        studioStyles: studioStyles,
        buildDirectory: buildDirectory,
        filterDirectory: filterDirectory,
        countries: countries,
        latLngToVector: latLngToVector,
        project: project,
        focusAngles: focusAngles,
        nearestAngle: nearestAngle,
        globeCircle: globeCircle,
        graticulePaths: graticulePaths,
        clusterPoints: clusterPoints,
        centroid: centroid,
        validateContact: validateContact,
        characterCount: characterCount,
        shortStudioName: shortStudioName,
        featuredInvitation: featuredInvitation,
        indexOrder: indexOrder,
        listLayout: listLayout
    };
}));
