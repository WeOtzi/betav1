/**
 * WE ÖTZI · Cotizador · Modelo puro del paso "¿Dónde quieres llevarlo?"
 * ---------------------------------------------------------------------
 * Trabaja sobre el árbol de body_parts que arma ConfigManager
 * (zonas raíz → subpartes) y sobre una selección plana de partes individuales:
 *
 *     [{ part: 'antebrazo', side: 'left' }, { part: 'abdomen', side: null }]
 *
 * `part` es siempre una parte individual (subparte, o la zona si no tiene
 * subpartes) y `side` es el lado ANATÓMICO ('left' | 'right') o null cuando la
 * parte no tiene lado. "Ambos lados" son dos ítems.
 *
 * De esa selección sale lo que se guarda en la cotización, compatible con lo
 * que ya leen el artista y el backoffice:
 *   - tattoo_body_part (varchar 255): "Brazo", "Brazo: Antebrazo, Mano",
 *     "Brazo: Antebrazo + Torso: Pecho"…
 *   - tattoo_body_side (varchar 50): "Izquierdo" | "Derecho" | "Ambos" | null.
 *     Si los lados no son uniformes va null y el lado viaja en el texto de la
 *     zona ("Brazo (izq.): Antebrazo + Pierna (der.): Muslo").
 *
 * Sin DOM ni red. Navegador: window.WoQuotationBodyModel · Node: require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoQuotationBodyModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var MAX_BODY_PART_LENGTH = 255;
    var ZONE_SEPARATOR = ' + ';
    var SIDE_LABELS = { left: 'Izquierdo', right: 'Derecho', both: 'Ambos' };
    var SIDE_SHORT = { left: 'izq.', right: 'der.', both: 'ambos lados' };
    var SIDE_LONG = { left: 'lado izquierdo', right: 'lado derecho', both: 'ambos lados' };

    function text(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function painOf(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return null;
        return Math.min(10, Math.max(1, Math.round(n)));
    }

    // Lados posibles de una parte según body_parts.sides.
    function sidesOf(value) {
        if (value === 'none') return [];
        if (value === 'left') return ['left'];
        if (value === 'right') return ['right'];
        return ['left', 'right'];
    }

    function leaf(node, zone) {
        return {
            id: text(node.id),
            label: text(node.label) || text(node.id),
            zoneId: zone.id,
            sides: sidesOf(node.sides),
            pain: painOf(node.pain_level),
            image: text(node.image),
            description: text(node.description),
            tattooInfo: text(node.tattoo_info),
            experienceInfo: text(node.experience_info),
            funFact: text(node.fun_fact)
        };
    }

    /**
     * Normaliza el árbol de ConfigManager.loadBodyPartsFromDB().
     * Una zona sin subpartes se trata como una única parte individual.
     */
    function createCatalog(tree) {
        var zones = [];
        var parts = {};
        var order = {};
        var index = 0;
        (Array.isArray(tree) ? tree : []).forEach(function (node) {
            if (!node || !text(node.id)) return;
            var zone = {
                id: text(node.id),
                label: text(node.label) || text(node.id),
                sides: sidesOf(node.sides),
                pain: painOf(node.pain_level),
                image: text(node.image),
                description: text(node.description),
                tattooInfo: text(node.tattoo_info),
                experienceInfo: text(node.experience_info),
                funFact: text(node.fun_fact),
                parts: []
            };
            var children = (Array.isArray(node.subparts) ? node.subparts : []).filter(function (c) { return c && text(c.id); });
            if (!children.length) children = [node];
            children.forEach(function (child) {
                var item = leaf(child, zone);
                if (parts[item.id]) return; // part_id es único en la tabla
                parts[item.id] = item;
                order[item.id] = index++;
                zone.parts.push(item);
            });
            if (zone.parts.length) zones.push(zone);
        });
        return { zones: zones, parts: parts, order: order };
    }

    function zoneById(catalog, zoneId) {
        var id = text(zoneId);
        for (var i = 0; i < catalog.zones.length; i++) {
            if (catalog.zones[i].id === id) return catalog.zones[i];
        }
        return null;
    }

    function partById(catalog, partId) {
        return (catalog && catalog.parts[text(partId)]) || null;
    }

    function itemKey(part, side) {
        return text(part) + '|' + (side || '');
    }

    // Deja solo ítems válidos para el catálogo, sin duplicados y en su orden.
    function sanitize(selection, catalog) {
        var seen = {};
        var out = [];
        (Array.isArray(selection) ? selection : []).forEach(function (item) {
            if (!item) return;
            var part = partById(catalog, item.part);
            if (!part) return;
            var side = item.side === 'left' || item.side === 'right' ? item.side : null;
            if (part.sides.length) {
                if (!side || part.sides.indexOf(side) === -1) return;
            } else {
                side = null;
            }
            var key = itemKey(part.id, side);
            if (seen[key]) return;
            seen[key] = true;
            out.push({ part: part.id, side: side });
        });
        out.sort(function (a, b) {
            var diff = catalog.order[a.part] - catalog.order[b.part];
            if (diff) return diff;
            return (a.side === 'right' ? 1 : 0) - (b.side === 'right' ? 1 : 0);
        });
        return out;
    }

    function has(selection, part, side) {
        var key = itemKey(part, side || null);
        return (selection || []).some(function (item) { return itemKey(item.part, item.side) === key; });
    }

    // Clic en la silueta: agrega o quita UNA parte individual.
    function toggle(selection, catalog, partId, side) {
        var part = partById(catalog, partId);
        var current = sanitize(selection, catalog);
        if (!part) return current;
        var wanted = part.sides.length ? side : null;
        if (part.sides.length && part.sides.indexOf(wanted) === -1) return current;
        if (has(current, part.id, wanted)) {
            return current.filter(function (item) { return itemKey(item.part, item.side) !== itemKey(part.id, wanted); });
        }
        return sanitize(current.concat([{ part: part.id, side: wanted }]), catalog);
    }

    function sideMode(leftIds, rightIds) {
        if (!leftIds.length && !rightIds.length) return null;
        if (!rightIds.length) return 'left';
        if (!leftIds.length) return 'right';
        var same = leftIds.length === rightIds.length && leftIds.every(function (id) { return rightIds.indexOf(id) !== -1; });
        return same ? 'both' : 'mixed';
    }

    /**
     * Estado de una zona dentro de la selección (para la grilla).
     * side: 'left' | 'right' | 'both' | 'mixed' | null (sin partes con lado).
     */
    function zoneState(selection, catalog, zoneId) {
        var zone = zoneById(catalog, zoneId);
        var empty = { selected: false, complete: false, parts: [], count: 0, total: zone ? zone.parts.length : 0, side: null };
        if (!zone) return empty;
        var current = sanitize(selection, catalog);
        var left = [];
        var right = [];
        var chosen = [];
        zone.parts.forEach(function (part) {
            var l = has(current, part.id, 'left');
            var r = has(current, part.id, 'right');
            var n = has(current, part.id, null);
            if (l) left.push(part.id);
            if (r) right.push(part.id);
            if (l || r || n) chosen.push(part.id);
        });
        if (!chosen.length) return empty;
        return {
            selected: true,
            complete: chosen.length === zone.parts.length,
            parts: chosen,
            count: chosen.length,
            total: zone.parts.length,
            side: sideMode(left, right)
        };
    }

    // ¿Alguna de estas partes de la zona tiene lado?
    function needsSide(catalog, zoneId, partIds) {
        var zone = zoneById(catalog, zoneId);
        if (!zone) return false;
        var wanted = Array.isArray(partIds) ? partIds.map(text) : null;
        return zone.parts.some(function (part) {
            return part.sides.length > 0 && (!wanted || wanted.indexOf(part.id) !== -1);
        });
    }

    /**
     * Borrador con el que se abre la ficha de una zona de la grilla.
     * Zona nueva: todas las subpartes marcadas (se desmarcan a gusto). El lado
     * arranca vacío en zonas con lado (brazo, pierna) y en "ambos" cuando la
     * zona es central (torso, espalda, cabeza) y solo algunas subpartes lo usan.
     */
    function draftForZone(selection, catalog, zoneId) {
        var zone = zoneById(catalog, zoneId);
        if (!zone) return { parts: [], side: null };
        var state = zoneState(selection, catalog, zoneId);
        if (state.selected) {
            return { parts: state.parts.slice(), side: state.side === 'mixed' ? 'both' : state.side };
        }
        var all = zone.parts.map(function (part) { return part.id; });
        var fixed = fixedSide(zone);
        return { parts: all, side: fixed || (zone.sides.length ? null : (needsSide(catalog, zoneId, all) ? 'both' : null)) };
    }

    // Zona cuyas partes con lado admiten uno solo (sides = 'left' | 'right').
    function fixedSide(zone) {
        var options = {};
        zone.parts.forEach(function (part) { part.sides.forEach(function (s) { options[s] = true; }); });
        var keys = Object.keys(options);
        return keys.length === 1 ? keys[0] : null;
    }

    function validateDraft(catalog, zoneId, draft) {
        var zone = zoneById(catalog, zoneId);
        if (!zone) return { ok: false, reason: 'zone', message: 'Elige una zona del cuerpo.' };
        var ids = (draft && Array.isArray(draft.parts) ? draft.parts : []).map(text)
            .filter(function (id) { return zone.parts.some(function (part) { return part.id === id; }); });
        if (!ids.length) return { ok: false, reason: 'parts', message: 'Deja marcada al menos una subparte.' };
        if (needsSide(catalog, zoneId, ids)) {
            var side = draft && draft.side;
            if (side !== 'left' && side !== 'right' && side !== 'both') {
                return { ok: false, reason: 'side', message: 'Elige de qué lado va el tatuaje.' };
            }
        }
        return { ok: true };
    }

    function removeZone(selection, catalog, zoneId) {
        var id = text(zoneId);
        return sanitize(selection, catalog).filter(function (item) {
            var part = partById(catalog, item.part);
            return !part || part.zoneId !== id;
        });
    }

    // Confirmar la ficha: reemplaza lo elegido de esa zona por el borrador.
    function applyZone(selection, catalog, zoneId, draft) {
        var zone = zoneById(catalog, zoneId);
        if (!zone || !validateDraft(catalog, zoneId, draft).ok) return sanitize(selection, catalog);
        var rest = removeZone(selection, catalog, zoneId);
        var wantedSides = draft.side === 'both' ? ['left', 'right'] : [draft.side];
        var added = [];
        zone.parts.forEach(function (part) {
            if (draft.parts.map(text).indexOf(part.id) === -1) return;
            if (!part.sides.length) {
                added.push({ part: part.id, side: null });
                return;
            }
            part.sides.forEach(function (side) {
                if (wantedSides.indexOf(side) !== -1) added.push({ part: part.id, side: side });
            });
        });
        return sanitize(rest.concat(added), catalog);
    }

    /**
     * Ítems que resultarían de aplicar el borrador (vista previa en la silueta
     * mientras la ficha está abierta). Con el borrador incompleto no agrega nada.
     */
    function previewItems(catalog, zoneId, draft) {
        if (!validateDraft(catalog, zoneId, draft).ok) return [];
        return applyZone([], catalog, zoneId, draft);
    }

    function labels(parts) {
        return parts.map(function (part) { return part.label; }).join(', ');
    }

    function segmentText(zone, parts, complete, tag) {
        var head = zone.label + (tag ? ' (' + tag + ')' : '');
        var single = zone.parts.length === 1 && zone.parts[0].id === zone.id;
        if (complete || single) return head;
        return head + ': ' + labels(parts);
    }

    /**
     * Describe la selección: texto para la cotización + datos para el resumen.
     * @returns {{count:number, bodyPart:string, bodySide:(string|null), zones:Array, pain:(null|{min:number,max:number})}}
     */
    function describe(selection, catalog) {
        var current = sanitize(selection, catalog);
        var zones = [];
        var pains = [];
        var refs = {};

        catalog.zones.forEach(function (zone) {
            var left = [];
            var right = [];
            var none = [];
            zone.parts.forEach(function (part) {
                var l = has(current, part.id, 'left');
                var r = has(current, part.id, 'right');
                var n = has(current, part.id, null);
                if (l) left.push(part);
                if (r) right.push(part);
                if (n) none.push(part);
                if ((l || r || n) && part.pain !== null) pains.push(part.pain);
            });
            if (!left.length && !right.length && !none.length) return;

            var mode = sideMode(left.map(function (p) { return p.id; }), right.map(function (p) { return p.id; }));
            var segments = [];
            if (mode === 'mixed') {
                var rightIds = right.map(function (p) { return p.id; });
                var leftIds = left.map(function (p) { return p.id; });
                var both = left.filter(function (p) { return rightIds.indexOf(p.id) !== -1; });
                var onlyLeft = left.filter(function (p) { return rightIds.indexOf(p.id) === -1; });
                var onlyRight = right.filter(function (p) { return leftIds.indexOf(p.id) === -1; });
                if (both.length) segments.push({ side: 'both', parts: both, complete: false });
                if (onlyLeft.length) segments.push({ side: 'left', parts: onlyLeft, complete: false });
                if (onlyRight.length) segments.push({ side: 'right', parts: onlyRight, complete: false });
                if (none.length) segments.push({ side: null, parts: none, complete: false });
            } else {
                var union = zone.parts.filter(function (part) {
                    return left.indexOf(part) !== -1 || right.indexOf(part) !== -1 || none.indexOf(part) !== -1;
                });
                segments.push({ side: mode, parts: union, complete: union.length === zone.parts.length });
            }
            refs[zone.id] = zone;
            zones.push({
                id: zone.id,
                label: zone.label,
                mode: mode,
                complete: mode !== 'mixed' && segments[0].complete,
                count: segments.reduce(function (sum, seg) { return sum + seg.parts.length; }, 0),
                total: zone.parts.length,
                segments: segments
            });
        });

        // Lado global: solo si todas las zonas con lado comparten uno.
        var modes = {};
        zones.forEach(function (zone) { if (zone.mode) modes[zone.mode] = true; });
        var modeKeys = Object.keys(modes);
        var uniform = modeKeys.length === 1 && modeKeys[0] !== 'mixed' ? modeKeys[0] : null;
        var embedSides = modeKeys.length > 0 && !uniform;

        function zoneText(zone, compact) {
            return zone.segments.map(function (seg) {
                var tag = embedSides && seg.side ? SIDE_SHORT[seg.side] : '';
                if (compact && !seg.complete && seg.parts.length > 1) {
                    return zone.label + (tag ? ' (' + tag + ')' : '') + ': ' + seg.parts.length + ' zonas';
                }
                return segmentText(refs[zone.id], seg.parts, seg.complete, tag);
            }).join(ZONE_SEPARATOR);
        }

        zones.forEach(function (zone) {
            zone.text = zoneText(zone, false);
            // Para el resumen bajo la silueta: el lado siempre visible.
            zone.summary = zone.segments.map(function (seg) {
                var head = seg.side ? SIDE_LONG[seg.side] : '';
                var body = seg.complete ? 'completo' : labels(seg.parts);
                return head ? head + ' · ' + body : body;
            }).join(' / ');
        });

        var bodyPart = zones.map(function (zone) { return zone.text; }).join(ZONE_SEPARATOR);
        if (bodyPart.length > MAX_BODY_PART_LENGTH) {
            bodyPart = zones.map(function (zone) { return zoneText(zone, true); }).join(ZONE_SEPARATOR);
        }
        if (bodyPart.length > MAX_BODY_PART_LENGTH) {
            bodyPart = bodyPart.slice(0, MAX_BODY_PART_LENGTH - 1).replace(/\s+\S*$/, '') + '…';
        }

        return {
            count: current.length,
            bodyPart: bodyPart,
            bodySide: uniform ? SIDE_LABELS[uniform] : null,
            zones: zones,
            pain: pains.length ? { min: Math.min.apply(null, pains), max: Math.max.apply(null, pains) } : null
        };
    }

    /**
     * Borradores guardados con el wizard anterior: un solo objeto
     * { id, zone, side: 'left'|'right'|null }. Si la parte tenía lado y no se
     * había elegido, no se migra (el cliente la vuelve a marcar).
     */
    function fromLegacy(saved, catalog) {
        var list = Array.isArray(saved) ? saved : [];
        if (!list.length) return [];
        if (list.every(function (item) { return item && typeof item.part === 'string'; })) {
            return sanitize(list, catalog);
        }
        var out = [];
        list.forEach(function (item) {
            if (!item) return;
            var zone = zoneById(catalog, item.zone);
            var isZone = zone && text(item.id) === zone.id && !partById(catalog, item.id);
            var targets = isZone ? zone.parts : [partById(catalog, item.id)].filter(Boolean);
            targets.forEach(function (part) {
                if (!part.sides.length) out.push({ part: part.id, side: null });
                else if (item.side === 'left' || item.side === 'right') out.push({ part: part.id, side: item.side });
            });
        });
        return sanitize(out, catalog);
    }

    function fold(value) {
        return text(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
    }

    /**
     * Lee un texto ya guardado en tattoo_body_part ("Brazo", "Brazo: Antebrazo,
     * Mano", "Brazo (izq.): Mano + Torso: Pecho"; también lo que entrega el
     * pre-cotizador, que no trae lado).
     * @returns {{selection:Array, pending:Array<{zoneId:string, parts:string[]}>}}
     *   `pending` son las zonas reconocidas a las que les falta el lado.
     */
    function parseText(bodyPart, bodySide, catalog) {
        var result = { selection: [], pending: [] };
        var raw = text(bodyPart);
        if (!raw || !catalog || !catalog.zones.length) return result;
        var globalSide = { izquierdo: 'left', derecho: 'right', ambos: 'both' }[fold(bodySide)] || null;
        var tags = { 'izq.': 'left', 'der.': 'right', 'ambos lados': 'both' };

        raw.split(/\s+\+\s+/).forEach(function (segment) {
            var match = /^(.+?)(?:\s*\((izq\.|der\.|ambos lados)\))?(?:\s*:\s*(.+))?$/i.exec(segment.trim());
            if (!match) return;
            var name = fold(match[1]);
            var zone = null;
            var ids = null;
            catalog.zones.forEach(function (candidate) { if (!zone && fold(candidate.label) === name) zone = candidate; });
            if (!zone) {
                // Texto con solo la subparte ("Antebrazo").
                Object.keys(catalog.parts).forEach(function (id) {
                    if (!zone && fold(catalog.parts[id].label) === name) {
                        zone = zoneById(catalog, catalog.parts[id].zoneId);
                        ids = [id];
                    }
                });
            }
            if (!zone) return;
            if (!ids && match[3]) {
                var wanted = match[3].split(',').map(fold).filter(Boolean);
                var found = zone.parts.filter(function (part) { return wanted.indexOf(fold(part.label)) !== -1; })
                    .map(function (part) { return part.id; });
                if (found.length) ids = found;
            }
            if (!ids) ids = zone.parts.map(function (part) { return part.id; });
            var side = (match[2] && tags[match[2].toLowerCase()]) || globalSide;
            var draft = { parts: ids, side: side };
            if (validateDraft(catalog, zone.id, draft).ok) {
                // Se suma (no reemplaza): una zona puede venir en varios tramos
                // cuando sus lados son distintos.
                result.selection = sanitize(result.selection.concat(previewItems(catalog, zone.id, draft)), catalog);
            } else {
                result.pending.push({ zoneId: zone.id, parts: ids });
            }
        });
        return result;
    }

    function painLabel(level) {
        var n = painOf(level);
        if (n === null) return '';
        if (n <= 3) return 'Bajo';
        if (n <= 6) return 'Moderado';
        if (n <= 8) return 'Alto';
        return 'Muy alto';
    }

    // Rango de dolor de un grupo de partes (para la ficha de la zona).
    function painRange(catalog, partIds) {
        var values = (partIds || []).map(function (id) {
            var part = partById(catalog, id);
            return part ? part.pain : null;
        }).filter(function (v) { return v !== null; });
        if (!values.length) return null;
        return { min: Math.min.apply(null, values), max: Math.max.apply(null, values) };
    }

    function partLabel(catalog, partId, side) {
        var part = partById(catalog, partId);
        if (!part) return '';
        return side && SIDE_LONG[side] ? part.label + ' · ' + SIDE_LONG[side] : part.label;
    }

    return {
        MAX_BODY_PART_LENGTH: MAX_BODY_PART_LENGTH,
        SIDE_LABELS: SIDE_LABELS,
        SIDE_SHORT: SIDE_SHORT,
        SIDE_LONG: SIDE_LONG,
        createCatalog: createCatalog,
        zoneById: zoneById,
        partById: partById,
        sanitize: sanitize,
        has: has,
        toggle: toggle,
        zoneState: zoneState,
        needsSide: needsSide,
        draftForZone: draftForZone,
        validateDraft: validateDraft,
        applyZone: applyZone,
        removeZone: removeZone,
        previewItems: previewItems,
        describe: describe,
        fromLegacy: fromLegacy,
        parseText: parseText,
        painLabel: painLabel,
        painRange: painRange,
        partLabel: partLabel
    };
}));
