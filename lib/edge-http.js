'use strict';
// Compatibilidad con el proxy de borde. En el VPS la app corre detrás del Traefik de
// Easypanel; en Hostinger, detrás de proxy.php. Lo que cambia entre los dos vive acá
// (deployments/vps/README.md, «Diferencias con el hosting compartido»).

/**
 * IP del cliente tal como la resuelve Express con `trust proxy` = 1: la que agregó el
 * proxy propio (Traefik o proxy.php). Nunca el PRIMER valor de X-Forwarded-For: Traefik
 * corre con forwardedHeaders.insecure y conserva lo que mande el cliente, así que ese
 * valor lo elige quien hace la petición. Tampoco cf-connecting-ip: no hay Cloudflare.
 */
function clientIp(req) {
    const raw = (req && (req.ip || (req.socket && req.socket.remoteAddress))) || '';
    return String(raw).trim().replace(/^::ffff:/i, '');
}

/**
 * Easypanel reemplaza todo 502 del backend por su página HTML (middleware
 * «bad-gateway-error-page», en todos los routers y sin opción por servicio). La app usa
 * 502 para «falló un servicio externo» con un JSON en español; esos salen como 504, que
 * el frontend trata igual que el 502 (sin casos especiales, a diferencia de 500 y 503).
 * Se toca writeHead porque por ahí pasan res.status(), sendStatus() y statusCode.
 */
const UPSTREAM_FAILURE_STATUS = 504;

function upstreamFailureStatus(req, res, next) {
    const writeHead = res.writeHead;
    res.writeHead = function writeHeadWithoutBadGateway(statusCode, ...rest) {
        if (statusCode === 502) {
            statusCode = UPSTREAM_FAILURE_STATUS;
            this.statusCode = UPSTREAM_FAILURE_STATUS;
        }
        return writeHead.call(this, statusCode, ...rest);
    };
    next();
}

/**
 * Paridad con Hostinger, que agregaba `Content-Security-Policy: upgrade-insecure-requests`.
 * Solo en HTTPS: en http://localhost subiría los recursos a https y rompería el entorno local.
 */
function upgradeInsecureRequests(req, res, next) {
    if (req.secure && !res.getHeader('Content-Security-Policy')) {
        res.setHeader('Content-Security-Policy', 'upgrade-insecure-requests');
    }
    next();
}

/**
 * Compresión (brotli/gzip), que antes hacía LiteSpeed. No comprime pedidos con Range:
 * un 206 tiene que conservar los bytes originales.
 */
function shouldCompress(req, res, compressionFilter) {
    if (req && req.headers && req.headers.range) return false;
    return compressionFilter(req, res);
}

/**
 * Traefik reutiliza las conexiones al backend hasta 90 s sin uso. Si Node las cierra
 * antes (5 s por defecto), un POST que cae justo en esa carrera recibe un 502.
 */
const KEEP_ALIVE_TIMEOUT_MS = 95000;
const HEADERS_TIMEOUT_MS = 96000;

function tuneServerTimeouts(server) {
    if (!server) return server;
    server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;
    return server;
}

module.exports = {
    clientIp,
    upstreamFailureStatus,
    UPSTREAM_FAILURE_STATUS,
    upgradeInsecureRequests,
    shouldCompress,
    tuneServerTimeouts,
    KEEP_ALIVE_TIMEOUT_MS,
    HEADERS_TIMEOUT_MS,
};
