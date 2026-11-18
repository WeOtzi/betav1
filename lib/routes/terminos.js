'use strict';

// ===========================================================================
// Rutas del gate de Términos y del bloqueo de reingreso (2.7.0).
//   GET  /api/account/terms-status   (Bearer)
//        { success, current, accepted, acceptedVersion,
//          roles:{artist,client,studio}, sanction:{kind,ends_at}|null, blocked }
//        Para cuentas nuevas sin aceptación registrada compara correo,
//        teléfono e Instagram con los identificadores baneados; si coincide,
//        bloquea la cuenta recién creada y responde blocked:true.
//   POST /api/account/terms-accept   (Bearer) { accepted:true, version, surface? }
//        409 TERMS_OUTDATED si la versión no es la vigente. Registra la
//        aceptación en terms_acceptances y re-sella todos los perfiles.
//   POST /api/register/precheck      (sin sesión) { email, phone, instagram, country, flow }
//        { ok:true } | 403 { ok:false, code:'REGISTRATION_BLOCKED', error }.
//        Solo mejora la experiencia (se puede saltear). Nunca dice por qué.
//   Barrido (sin navegador): cada SWEEP_INTERVAL_MS el servidor revisa las
//        cuentas creadas desde REENTRY_ENFORCED_SINCE sin aceptación ni
//        revisión al día (RPC terms_reentry_pending) y bloquea las que
//        coinciden. Es el control real para altas de cliente y estudio, que
//        el navegador hace directo contra Supabase: no depende de que la
//        página llame a terms-status.
//   Excepción de soporte: una cuenta con cleared_at en terms_reentry_checks
//        (soporte levantó su cierre o descartó su alerta de reingreso) no
//        vuelve a bloquearse: checkReentry la deja pasar y la RPC del barrido
//        no la lista. Ver lib/terms-gate.js.
// Lógica pura en lib/terms-gate.js; datos en lib/repos/terminos.js.
// La línea register(app) en server.js la agrega la integración.
// ===========================================================================

const gate = require('../terms-gate');

// Dependencias reemplazables desde los tests.
const deps = {
    resolveUser: (req) => require('../auth/supabase-auth').resolveBearerUser(req),
    repo: null, // se resuelve al usarlo: require('../repos/terminos').TerminosRepo
    sanctions: undefined, // undefined = carga diferida de lib/sanciones-service
    now: () => Date.now(),
    log: (...args) => console.warn(...args),
    statusLimiter: null,
    acceptLimiter: null,
    precheckLimiter: null,
    // Barrido del bloqueo de reingreso. 0 lo desactiva (tests).
    sweepIntervalMs: 10 * 60 * 1000,
    sweepFirstDelayMs: 60 * 1000,
    sweepLimit: 50
};

function setDeps(overrides) {
    const previous = { ...deps };
    Object.assign(deps, overrides || {});
    return () => { Object.assign(deps, previous); };
}

function repo() {
    return deps.repo || require('../repos/terminos').TerminosRepo;
}

function serviceOpts() {
    return { service: deps.sanctions, log: deps.log };
}

function userAgentOf(req) {
    const ua = req && req.headers && req.headers['user-agent'];
    return ua ? String(ua).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300) : null;
}

/**
 * Comprueba el reingreso de una cuenta ya creada y, si coincide con una
 * sanción, la bloquea. Devuelve true si quedó bloqueada.
 */
async function reentryBlocks({ user, profiles, acceptances, flow }) {
    if (!gate.needsReentryCheck({ user, acceptances, now: deps.now() })) return false;
    const check = await gate.checkReentrySafe(gate.reentryInputs({ user, profiles, flow }), serviceOpts());
    if (!check.blocked) return false;
    await gate.blockNewAccountSafe({ userId: user.id, matches: check.matches, flow }, serviceOpts());
    return true;
}

function sweepFlow(profiles) {
    const roles = gate.rolesFrom(profiles);
    if (roles.studio) return 'studio';
    if (roles.client) return 'client';
    if (roles.artist) return 'artist';
    return 'login';
}

/**
 * Barrido: revisa en el servidor las cuentas nuevas pendientes. Solo marca
 * como revisada una cuenta si la comprobación corrió de verdad (si
 * sanciones-service falla, se reintenta en la próxima vuelta).
 * Devuelve { checked, blocked, skipped }.
 */
let sweepRunning = false;
async function sweepPendingAccounts({ limit = deps.sweepLimit } = {}) {
    if (sweepRunning) return { checked: 0, blocked: 0, skipped: true };
    sweepRunning = true;
    const out = { checked: 0, blocked: 0, skipped: false };
    try {
        const pending = await repo().listPendingReentry(gate.REENTRY_ENFORCED_SINCE, limit);
        for (const row of pending) {
            if (!row || !row.user_id) continue;
            try {
                const user = {
                    id: row.user_id,
                    email: row.email || null,
                    raw: { phone: row.phone || null, created_at: row.created_at || null, user_metadata: row.user_metadata || {} }
                };
                const profiles = await repo().getProfiles(user.id);
                const flow = sweepFlow(profiles);
                const check = await gate.checkReentrySafe(gate.reentryInputs({ user, profiles, flow }), serviceOpts());
                if (!check.checked && !check.blocked) break; // servicio caído: se reintenta en la próxima vuelta
                if (check.blocked) {
                    const done = await gate.blockNewAccountSafe({ userId: user.id, matches: check.matches, flow }, serviceOpts());
                    if (!done) continue; // sin bloquear: se reintenta
                    out.blocked += 1;
                }
                await repo().recordReentryCheck(user.id, { blocked: check.blocked, checkedAt: new Date(deps.now()).toISOString() });
                out.checked += 1;
            } catch (err) {
                deps.log('[terminos] barrido: una cuenta no se pudo revisar:', err && err.message);
            }
        }
    } catch (err) {
        deps.log('[terminos] barrido:', err && err.message);
    } finally {
        sweepRunning = false;
    }
    return out;
}

let sweepTimer = null;
function startSweep() {
    if (sweepTimer || !(deps.sweepIntervalMs > 0)) return null;
    const run = () => { sweepPendingAccounts().catch(() => {}); };
    const first = setTimeout(() => {
        run();
        sweepTimer = setInterval(run, deps.sweepIntervalMs);
        if (sweepTimer.unref) sweepTimer.unref();
    }, Math.max(0, deps.sweepFirstDelayMs || 0));
    if (first.unref) first.unref();
    sweepTimer = first;
    return sweepTimer;
}

async function statusHandler(req, res) {
    const user = await deps.resolveUser(req);
    if (!user) return res.status(401).json({ success: false, error: 'Inicia sesión para continuar.' });
    try {
        const [acceptances, profiles, sanction] = await Promise.all([
            repo().listAcceptances(user.id),
            repo().getProfiles(user.id),
            gate.activeSanctionSafe(user.id, serviceOpts())
        ]);
        const state = gate.acceptanceState({ acceptances, profiles, current: gate.TERMS_VERSION });
        const blocked = await reentryBlocks({ user, profiles, acceptances, flow: 'login' });
        res.set && res.set('Cache-Control', 'no-store');
        return res.json({
            success: true,
            current: gate.TERMS_VERSION,
            accepted: state.accepted,
            acceptedVersion: state.acceptedVersion,
            roles: gate.rolesFrom(profiles),
            sanction,
            blocked
        });
    } catch (err) {
        deps.log('[terminos] estado:', err && err.message);
        return res.status(503).json({ success: false, error: 'No pudimos revisar el estado de tu cuenta. Intenta de nuevo.' });
    }
}

async function acceptHandler(req, res) {
    const user = await deps.resolveUser(req);
    if (!user) return res.status(401).json({ success: false, error: 'Inicia sesión para continuar.' });
    const valid = gate.validateAccept(req.body, gate.TERMS_VERSION);
    if (!valid.ok) {
        const body = { success: false, code: valid.code, error: valid.error };
        if (valid.current) body.current = valid.current;
        return res.status(valid.status).json(body);
    }
    try {
        const sanction = await gate.activeSanctionSafe(user.id, serviceOpts());
        if (sanction && sanction.kind === 'ban') {
            return res.status(403).json({ success: false, code: 'ACCOUNT_SANCTIONED', error: 'Tu cuenta fue dada de baja por incumplir los Términos.' });
        }
        const [acceptances, profiles] = await Promise.all([
            repo().listAcceptances(user.id),
            repo().getProfiles(user.id)
        ]);
        // Quien llama directo a este endpoint sin pasar por terms-status
        // también pasa por el bloqueo de reingreso.
        if (await reentryBlocks({ user, profiles, acceptances, flow: 'login' })) {
            return res.status(403).json({ success: false, ...gate.REGISTRATION_BLOCKED });
        }
        const acceptedAt = new Date(deps.now()).toISOString();
        const surface = gate.normalizeSurface(req.body && req.body.surface);
        const recorded = await repo().insertAcceptance({ userId: user.id, version: valid.version, surface, userAgent: userAgentOf(req) });
        if (recorded.missingTable) deps.log('[terminos] falta la migración 20261118120000: solo se sellan los perfiles');
        const stamped = await repo().stampAllProfiles(user.id, { version: valid.version, acceptedAt });
        return res.json({ success: true, version: valid.version, recorded: recorded.stored, stamped });
    } catch (err) {
        deps.log('[terminos] aceptación:', err && err.message);
        return res.status(500).json({ success: false, error: 'No pudimos guardar tu aceptación. Intenta de nuevo.' });
    }
}

async function precheckHandler(req, res) {
    const parsed = gate.precheckInput(req.body);
    // Datos incompletos o raros: no hay nada que comparar; la validación del
    // formulario la hace cada alta.
    if (!parsed.ok) return res.json({ ok: true });
    const check = await gate.checkReentrySafe(parsed.input, serviceOpts());
    if (check.blocked) return res.status(403).json({ ok: false, ...gate.REGISTRATION_BLOCKED });
    return res.json({ ok: true });
}

function defaultLimiter(windowMs, max, message) {
    const rateLimit = require('express-rate-limit');
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message
    });
}

function register(app, overrides) {
    if (!app) throw new Error('[terminos] falta la app de Express');
    if (overrides && typeof overrides === 'object') {
        for (const key of Object.keys(deps)) {
            if (overrides[key] !== undefined) deps[key] = overrides[key];
        }
    }
    const tooMany = { success: false, error: 'Demasiados intentos. Prueba de nuevo en unos minutos.' };
    const statusLimiter = deps.statusLimiter || defaultLimiter(15 * 60 * 1000, 120, tooMany);
    const acceptLimiter = deps.acceptLimiter || defaultLimiter(15 * 60 * 1000, 20, tooMany);
    // Estricto: sin sesión y sirve de oráculo si se abusa.
    const precheckLimiter = deps.precheckLimiter || defaultLimiter(15 * 60 * 1000, 10, { ok: false, error: 'Demasiados intentos. Prueba de nuevo en unos minutos.' });
    app.get('/api/account/terms-status', statusLimiter, statusHandler);
    app.post('/api/account/terms-accept', acceptLimiter, acceptHandler);
    app.post('/api/register/precheck', precheckLimiter, precheckHandler);
    startSweep();
}

module.exports = {
    register,
    _internal: { setDeps, deps, statusHandler, acceptHandler, precheckHandler, reentryBlocks, sweepPendingAccounts, startSweep }
};
