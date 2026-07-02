'use strict';

// Repositorio de Analytics no-cotizacion (servidor). Encapsula las queries de
// los endpoints /api/analytics/{users,devices,pages,errors,locations,summary}
// que antes vivian inline como `supabaseQuery(cfg, '<path>')`. Lee con la ANON
// key (via getHealthConfig -> cfg.supabaseAnonKey), mismo contexto de auth que
// antes: cada metodo delega en pgrest.raw conservando exactamente el path.

const { pgrest } = require('../postgrest');

function sinceIso(days) {
    return new Date(Date.now() - days * 86400000).toISOString();
}
// Filtro de entorno opcional (cuando env !== 'all'). La POSICION del filtro en
// la query se preserva por metodo para no cambiar el comportamiento.
function envFilter(env) {
    return env && env !== 'all' ? `&environment=eq.${env}` : '';
}
async function query(cfg, path) {
    const rows = await pgrest.raw(path, { apiKey: cfg.supabaseAnonKey });
    return rows || [];
}

const AnalyticsRepo = {
    // /api/analytics/users — sesiones por tipo de usuario
    userSessionsByType(cfg, { days, env }) {
        return query(cfg, `analytics_user_sessions?select=user_type,created_at&created_at=gte.${sinceIso(days)}${envFilter(env)}`);
    },
    // /api/analytics/users — fingerprints (usuarios unicos)
    userFingerprints(cfg, { days, env }) {
        return query(cfg, `analytics_user_sessions?select=device_fingerprint,created_at&created_at=gte.${sinceIso(days)}${envFilter(env)}`);
    },
    // /api/analytics/devices
    devices(cfg, { days, env }) {
        return query(cfg, `analytics_devices?select=os,device_type,browser,created_at${envFilter(env)}&created_at=gte.${sinceIso(days)}`);
    },
    // /api/analytics/pages
    pageViews(cfg, { days, env }) {
        return query(cfg, `analytics_user_sessions?select=page_path,created_at${envFilter(env)}&created_at=gte.${sinceIso(days)}`);
    },
    // /api/analytics/errors
    errorSessions(cfg, { days, env }) {
        return query(cfg, `analytics_user_sessions?select=page_path,error_count,user_type,environment,created_at&has_errors=eq.true&created_at=gte.${sinceIso(days)}${envFilter(env)}&order=created_at.desc`);
    },
    // /api/analytics/locations
    locations(cfg, { days, env }) {
        return query(cfg, `analytics_user_sessions?select=user_ip,country,city,created_at&user_ip=not.is.null${envFilter(env)}&created_at=gte.${sinceIso(days)}`);
    },
    // /api/analytics/summary — sesiones
    summarySessions(cfg, { days, env }) {
        return query(cfg, `analytics_user_sessions?select=user_type,page_path,has_errors,error_count,device_fingerprint,environment,created_at&created_at=gte.${sinceIso(days)}${envFilter(env)}`);
    },
    // /api/analytics/summary — dispositivos
    summaryDevices(cfg, { days }) {
        return query(cfg, `analytics_devices?select=device_type,created_at&created_at=gte.${sinceIso(days)}`);
    },
};

module.exports = { AnalyticsRepo };
