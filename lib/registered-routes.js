'use strict';

/**
 * Lista las rutas registradas en el router de Express para el banner de
 * arranque. Express guarda layer.route.path tal como se registró: puede ser
 * un string, un array de strings o una RegExp. Solo se listan los strings;
 * un array se expande y una RegExp se ignora (nunca tira el arranque).
 */
function listRegisteredRoutes(stack, prefixes = ['/api/', '/shared/']) {
    return (Array.isArray(stack) ? stack : [])
        .filter(layer => layer && layer.route && layer.route.path)
        .flatMap(layer => {
            const methods = Object.keys(layer.route.methods || {})
                .map(method => method.toUpperCase())
                .sort()
                .join(',');
            const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
            return paths
                .filter(p => typeof p === 'string')
                .map(p => ({ methods, path: p }));
        })
        .filter(route => prefixes.some(prefix => route.path.startsWith(prefix)))
        .sort((a, b) => `${a.path} ${a.methods}`.localeCompare(`${b.path} ${b.methods}`));
}

module.exports = { listRegisteredRoutes };
