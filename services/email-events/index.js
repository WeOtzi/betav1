'use strict';

// ===========================================================================
// Cargador de eventos de email por frente (services/email-events/*.js)
// ---------------------------------------------------------------------------
// Cada archivo de este directorio (salvo index.js) exporta un objeto
//   { <event_id>: { name, description, templateHint, recipient | recipients,
//                   recipientRoles?, attribs?, render: {...}, serverOnly? } }
// services/email-event-mapping.js lo suma a EVENTS, lib/email-render usa
// `render` y services/email-request-context.js suma los `serverOnly: true` a
// SERVER_ONLY_EVENTS. Ver README.md.
// ===========================================================================

const fs = require('fs');
const path = require('path');

const ID_RE = /^[a-z][a-z0-9_]{2,80}$/;

function validateEvent(id, def, file) {
    if (!ID_RE.test(id)) return `${file}: id inválido "${id}"`;
    if (!def || typeof def !== 'object') return `${file}: ${id} no es un objeto`;
    if (typeof def.recipient !== 'function' && typeof def.recipients !== 'function') {
        return `${file}: ${id} necesita recipient(p) o recipients(p)`;
    }
    if (def.render !== undefined && (typeof def.render !== 'object' || !def.render)) {
        return `${file}: ${id}.render debe ser un objeto`;
    }
    return null;
}

/**
 * Lee todos los módulos del directorio (orden alfabético, determinista).
 * @returns {{ events: Object<string, object>, sources: Object<string,string>, errors: string[] }}
 */
function loadEmailEvents(dir = __dirname) {
    const events = {};
    const sources = {};
    const errors = [];
    let files = [];
    try {
        files = fs.readdirSync(dir).filter(name => name.endsWith('.js') && name !== 'index.js').sort();
    } catch (_) {
        return { events, sources, errors };
    }
    for (const file of files) {
        let mod;
        try {
            mod = require(path.join(dir, file));
        } catch (error) {
            errors.push(`${file}: no se pudo cargar (${error.message})`);
            continue;
        }
        if (!mod || typeof mod !== 'object') {
            errors.push(`${file}: debe exportar un objeto { event_id: {...} }`);
            continue;
        }
        for (const [id, def] of Object.entries(mod)) {
            const problem = validateEvent(id, def, file);
            if (problem) { errors.push(problem); continue; }
            if (sources[id]) {
                errors.push(`${file}: ${id} ya está definido en ${sources[id]} (se ignora)`);
                continue;
            }
            events[id] = def;
            sources[id] = file;
        }
    }
    if (errors.length) console.warn('[email-events]', errors.join(' | '));
    return { events, sources, errors };
}

module.exports = { loadEmailEvents, validateEvent };
