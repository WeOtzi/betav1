'use strict';

// ===========================================================================
// Servicio de sanciones (fase 1 · 2.7.0): orquesta repos, Auth y correos.
// ---------------------------------------------------------------------------
// Contrato con otros equipos (docs/plans/2026-11-18-kyc-sprints.md):
//   checkReentry({ email, phone, instagram, country, flow, userId })
//     → { blocked, matches: [{ kind, sanction_id }] }. Falla abierta.
//   blockNewAccount({ userId, matches, flow })  → banea la cuenta nueva. Idempotente.
//   getActiveSanction(userId) → { id, kind, status, ends_at } | null
//
// Además, para lib/routes/sanciones.js:
//   proposeSanction, applySanction (confirmar / reintentar), liftSanction,
//   decideAppeal, getAppealView, submitAppeal, updateAlert, liftExpiredSuspensions,
//   recordReentryException (excepción del bloqueo de reingreso; ver liftSanction).
//
// Idempotencia: cada paso hecho se guarda en account_sanctions.side_effects
// (`steps` al aplicar, `lift` al levantar). Un reintento corre solo los pasos
// que faltan; las escrituras de los repos son condicionales y los correos
// llevan clave de idempotencia (services/email-service.js → dispatchOnce).
//
// Privacidad: nunca se loguean correos, teléfonos ni handles; las alertas y
// los correos a soporte llevan ids y tipos de coincidencia, no valores.
// ===========================================================================

const crypto = require('crypto');
const S = require('./sanciones');
const BanIds = require('./ban-identifiers');
const { SancionesRepo, isMissingSchemaError } = require('./repos/sanciones');
const { BannedIdentifiersRepo } = require('./repos/banned-identifiers');
const { publicBaseUrl } = require('./email-format');

const EVENTS = {
    notice: 'account_sanction_notice',
    lifted: 'account_sanction_lifted',
    upheld: 'account_sanction_appeal_upheld',
    clientCancelled: 'quotation_cancelled_profile_removed',
    supportAlert: 'support_security_alert',
    supportAppeal: 'support_appeal_received'
};

const FLOW_LABELS = {
    artist: 'Registro de artista',
    client: 'Registro de cliente',
    studio: 'Registro de estudio',
    instagram: 'Validación de Instagram',
    login: 'Inicio de sesión',
    precheck: 'Comprobación antes del registro'
};
const MATCH_KIND_LABELS = { email: 'correo', phone: 'teléfono', instagram: 'Instagram', document: 'documento', face: 'rostro' };
const DASHBOARD_PATHS = { artist: '/artist/dashboard', studio: '/studio/dashboard', client: '/client/dashboard' };
const ALERT_DEDUPE_MS = 24 * 60 * 60 * 1000;
const EXPIRY_THROTTLE_MS = 10 * 60 * 1000;

// Dependencias reemplazables desde los tests.
const deps = {
    repo: SancionesRepo,
    identifiersRepo: BannedIdentifiersRepo,
    authAdmin: require('./auth/supabase-admin'),
    sendEmail: (...args) => require('../services/email-service').sendEmail(...args),
    baseUrl: () => publicBaseUrl(),
    env: () => process.env,
    now: () => new Date(),
    // Excepción del bloqueo de reingreso (public.terms_reentry_checks).
    // null = lib/repos/terminos.js (carga diferida).
    reentryRepo: null
};

function setDeps(overrides) {
    const previous = { ...deps };
    Object.assign(deps, overrides || {});
    return () => { Object.assign(deps, previous); };
}

function fail(status, code, error, extra) {
    return { ok: false, status, code, error, ...(extra || {}) };
}

function short(err) {
    return String((err && err.message) || err || '').slice(0, 200);
}

function nowIso() {
    return deps.now().toISOString();
}

// --- concurrencia -------------------------------------------------------------------
// Aplicar y levantar tocan Auth, perfiles y billetera: dos corridas a la vez
// sobre la misma sanción (un reintento contra un levantamiento, dos agentes
// confirmando) se pisarían. Por eso:
//   · cada corrida toma un turno (`side_effects.running`) con vencimiento; otra
//     corrida responde 409 BUSY mientras el turno esté vigente;
//   · side_effects se guarda leyendo la versión más reciente, mezclando solo
//     lo de este paso y escribiendo con updated_at como condición (el trigger
//     trg_account_sanctions_updated_at lo cambia en cada UPDATE);
//   · antes de cada paso se vuelve a comprobar el estado y el turno.
// Riesgo residual: si un solo paso tardara más que LEASE_MS, otra corrida
// podría tomar el turno; el paso siguiente de la primera aborta con 409.

const LEASE_MS = 5 * 60 * 1000;
const COMMIT_TRIES = 4;
const BUSY_MESSAGE = 'Otro agente la está aplicando o levantando en este momento. Espera un momento y actualiza.';

function conflict(code, message) {
    const err = new Error(message);
    err.status = 409;
    err.code = code;
    return err;
}

function failFromConflict(err) {
    return fail(409, err.code || 'CHANGED', err.message);
}

// Lee la versión actual, aplica `mutate(se, fresh)` y la guarda solo si nadie
// la cambió entre medio (reintenta con la nueva versión). `check(fresh)` puede
// lanzar un conflicto para abortar.
async function commitSideEffects(id, mutate, { check = null } = {}) {
    for (let i = 0; i < COMMIT_TRIES; i += 1) {
        const fresh = await deps.repo.getSanction(id);
        if (!fresh) throw conflict('NOT_FOUND', 'La sanción ya no existe.');
        if (check) check(fresh);
        const se = S.sideEffects(fresh);
        mutate(se, fresh);
        const saved = await deps.repo.saveSideEffects(id, se, { expectUpdatedAt: fresh.updated_at || null });
        if (saved) return { ...fresh, ...saved, side_effects: se };
    }
    throw conflict('CHANGED', 'La sanción cambió mientras la guardábamos. Actualiza y vuelve a intentarlo.');
}

function leaseHeldBy(fresh, runId) {
    const r = S.sideEffects(fresh).running;
    return Boolean(r && r.id === runId);
}

function leaseBusy(fresh, runId) {
    const r = S.sideEffects(fresh).running;
    if (!r || r.id === runId) return false;
    const until = new Date(r.until).getTime();
    return Number.isFinite(until) && until > deps.now().getTime();
}

function newLease(runId, op) {
    return { id: runId, op, until: new Date(deps.now().getTime() + LEASE_MS).toISOString() };
}

// Toma el turno de la sanción. `allowed(status)` decide si la operación sigue
// teniendo sentido con el estado actual. Devuelve la fila fresca.
async function acquireLease(id, runId, op, allowed, notAllowedMessage) {
    return commitSideEffects(id, (se) => { se.running = newLease(runId, op); }, {
        check: (fresh) => {
            if (leaseBusy(fresh, runId)) throw conflict('BUSY', BUSY_MESSAGE);
            if (!allowed(fresh.status)) throw conflict('CHANGED', notAllowedMessage);
        }
    });
}

async function releaseLease(id, runId) {
    try {
        await commitSideEffects(id, (se) => { if (se.running && se.running.id === runId) delete se.running; });
    } catch (err) {
        console.warn(`[sanciones] no se pudo soltar el turno de ${id}:`, short(err));
    }
}

// --- contexto de la cuenta ---------------------------------------------------------

async function loadProfiles(ctx) {
    if (!ctx.profiles) ctx.profiles = await deps.repo.accountProfiles(ctx.userId);
    return ctx.profiles;
}

async function loadAuth(ctx) {
    if (ctx.auth === undefined) {
        try { ctx.auth = await deps.authAdmin.getAuthUser(ctx.userId); } catch (err) {
            console.warn('[sanciones] auth lookup failed:', short(err));
            ctx.auth = null;
        }
    }
    return ctx.auth;
}

function roleOf(profiles) {
    if (profiles && profiles.artist) return 'artist';
    if (profiles && profiles.studios && profiles.studios.length) return 'studio';
    return 'client';
}

async function recipientFor(ctx) {
    const [profiles, auth] = await Promise.all([loadProfiles(ctx), loadAuth(ctx)]);
    const role = roleOf(profiles);
    const name = (profiles.artist && profiles.artist.name)
        || (role === 'studio' && profiles.studios[0] && profiles.studios[0].name)
        || (profiles.client && profiles.client.full_name)
        || (auth && auth.full_name) || '';
    return { email: (auth && auth.email) || '', name: S.cleanLine(name, 120), role };
}

async function supportRecipients() {
    const supportEmail = String(process.env.SUPPORT_EMAIL || '').trim();
    if (supportEmail) return { support_email: supportEmail, support_emails: [] };
    const list = await deps.repo.activeSupportEmails().catch(() => []);
    return { support_email: '', support_emails: list };
}

async function send(eventId, payload, idempotencyKey) {
    try {
        const result = await deps.sendEmail(eventId, payload, { idempotencyKey, ignorePreferences: true });
        return Boolean(result && result.ok);
    } catch (err) {
        console.warn(`[sanciones] correo ${eventId} no enviado:`, short(err));
        return false;
    }
}

function matchKindsLabel(kinds) {
    return [...new Set(kinds || [])].map((k) => MATCH_KIND_LABELS[k] || k).join(', ');
}

// Anticipos retenidos de una alerta refund_needed: «50.000 ARS + 20 USD».
function totalsLabel(totals) {
    if (!Array.isArray(totals)) return '';
    return totals
        .filter((t) => t && Number.isFinite(Number(t.amount)) && Number(t.amount) > 0)
        .map((t) => `${Number(t.amount).toLocaleString('es-AR', { maximumFractionDigits: 2 })} ${String(t.currency || '').toUpperCase().slice(0, 8)}`.trim())
        .join(' + ');
}

// Aviso a soporte por una alerta de seguridad. Nunca rompe al llamador.
async function notifySupportAlert(alert, extra = {}) {
    if (!alert || !alert.id) return false;
    try {
        const to = await supportRecipients();
        if (!to.support_email && !to.support_emails.length) return false;
        const payload = alert.payload || {};
        return await send(EVENTS.supportAlert, {
            app_base_url: deps.baseUrl(),
            ...to,
            alert_id: alert.id,
            alert_kind: alert.kind,
            kind_label: S.ALERT_KIND_LABELS[alert.kind] || 'Alerta de seguridad',
            flow_label: FLOW_LABELS[payload.flow] || '',
            match_kinds_label: matchKindsLabel(payload.match_kinds),
            sanction_id: payload.sanction_id || (payload.sanction_ids && payload.sanction_ids[0]) || '',
            subject_user_id: alert.subject_user_id || '',
            related_user_id: alert.related_user_id || '',
            quotes_count: Array.isArray(payload.quotes) ? String(payload.quotes.length) : '',
            totals_label: totalsLabel(payload.totals),
            created_at: alert.created_at || nowIso(),
            ...extra
        }, `${EVENTS.supportAlert}:${alert.id}`);
    } catch (err) {
        console.warn('[sanciones] aviso de alerta no enviado:', short(err));
        return false;
    }
}

// --- pasos de aplicación ---------------------------------------------------------------

function phoneWithPlus(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.startsWith('+') ? text : `+${text}`;
}

// Huellas de la cuenta: correo y teléfono de Auth, WhatsApp e Instagram del
// perfil de artista, de cliente y de los estudios que es dueña.
function collectIdentifiers(auth, profiles) {
    const env = deps.env();
    const list = [];
    const artist = profiles.artist;
    const client = profiles.client;
    list.push(...BanIds.identifiersFor({
        email: auth && auth.email,
        // auth.users.phone se guarda en E.164 sin el "+".
        phone: phoneWithPlus(auth && auth.phone),
        country: (artist && artist.country) || (client && client.country) || null
    }, env));
    if (artist) list.push(...BanIds.identifiersFor({ phone: artist.whatsapp_number, instagram: artist.instagram, country: artist.country }, env));
    if (client) list.push(...BanIds.identifiersFor({ phone: client.whatsapp, instagram: client.instagram, country: client.country }, env));
    for (const studio of profiles.studios || []) {
        list.push(...BanIds.identifiersFor({
            phone: [studio.whatsapp, studio.contact_phone, studio.phone].filter(Boolean),
            instagram: studio.instagram,
            country: studio.country
        }, env));
    }
    const seen = new Set();
    return list.filter((i) => {
        const key = `${i.kind}:${i.value_hmac}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function clientKey(quote) {
    if (S.isUuid(quote.client_user_id)) return quote.client_user_id;
    const email = BanIds.normalizeEmail(quote.client_email);
    if (email) return `email:${crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)}`;
    return `quote:${quote.quote_id}`;
}

function quotationUrl(base, quote) {
    const q = encodeURIComponent(String(quote.quote_id || ''));
    return S.isUuid(quote.client_user_id) ? `${base}/client/dashboard?quote=${q}` : `${base}/my-quotations/detail?quote=${q}`;
}

const APPLY_RUNNERS = {
    async activate(ctx) {
        const { sanction, agent } = ctx;
        const updated = await deps.repo.updateSanction(sanction.id, {
            status: 'active',
            confirmed_by: agent ? agent.userId : null,
            starts_at: nowIso()
        }, { expectStatus: 'proposed' });
        if (updated) { ctx.sanction = updated; return { by: agent ? agent.userId : null, note: ctx.note || '' }; }
        // Otro agente la activó primero: no se repiten los pasos desde aquí.
        const current = await deps.repo.getSanction(sanction.id);
        if (current && S.EFFECTIVE_STATUSES.includes(current.status)) throw conflict('BUSY', BUSY_MESSAGE);
        throw conflict('CHANGED', 'La sanción ya no está pendiente de confirmación.');
    },

    async profile(ctx) {
        const profiles = await loadProfiles(ctx);
        const state = S.profileState(ctx.sanction.kind);
        let artist = false;
        if (profiles.artist) {
            await deps.repo.setArtistSanctionState(ctx.userId, state, ctx.sanction.id);
            artist = true;
        }
        // Un estudio que ya tocó esta sanción en un intento anterior estaba activo.
        const studios = (profiles.studios || []).map((s) => ({
            id: s.id,
            was_active: s.sanction_id === ctx.sanction.id ? true : s.is_active !== false
        }));
        if (studios.length) {
            await deps.repo.setStudiosSanctionState(studios.map((s) => s.id), { state, sanctionId: ctx.sanction.id, isActive: false });
        }
        return { artist, state, studios };
    },

    // Primero fija la lista de cotizaciones abiertas de ESTA sanción
    // (side_effects.pending_quotes) y después cancela solo esas: un reintento
    // usa la misma lista, y las canceladas por una sanción anterior ya
    // levantada no se vuelven a contar (ni a avisar, ni a pedir devolución).
    async quotations(ctx, se) {
        let ids = se.pending_quotes && Array.isArray(se.pending_quotes.ids) ? se.pending_quotes.ids : null;
        if (!ids) {
            ids = await deps.repo.listOpenQuotationIds(ctx.userId);
            const at = nowIso();
            await ctx.commit((fresh) => { fresh.pending_quotes = { ids, at }; });
        }
        const rows = ids.length ? await deps.repo.cancelOpenQuotations(ctx.userId, ids) : [];
        return { count: rows.length, quotes: rows.map((q) => ({ id: q.id, quote_id: q.quote_id })) };
    },

    async client_notices(ctx, se) {
        const recorded = (se.steps.quotations && se.steps.quotations.quotes) || [];
        if (!recorded.length) return { sent: 0, total: 0 };
        const rows = await deps.repo.getQuotationsByIds(recorded.map((q) => q.id));
        const base = ctx.baseUrl;
        let sent = 0;
        for (const quote of rows) {
            let email = '';
            let name = S.cleanLine(quote.client_full_name, 120);
            if (S.isUuid(quote.client_user_id)) {
                const auth = await deps.authAdmin.getAuthUser(quote.client_user_id).catch(() => null);
                email = (auth && auth.email) || '';
                if (!name && auth && auth.full_name) name = S.cleanLine(auth.full_name, 120);
            }
            if (!email) email = String(quote.client_email || '').trim().toLowerCase();
            if (!email) continue;
            const ok = await send(EVENTS.clientCancelled, {
                app_base_url: base,
                recipient_email: email,
                recipient_name: name,
                recipient_role: 'client',
                client_user_id: quote.client_user_id || '',
                quote_id: quote.quote_id,
                artist_name: S.cleanLine(quote.artist_name, 120),
                cancelled_at: nowIso(),
                quotation_url: quotationUrl(base, quote)
            }, `${EVENTS.clientCancelled}:${quote.quote_id}`);
            if (ok) sent += 1;
        }
        return { sent, total: rows.length };
    },

    async wallet(ctx) {
        const profiles = await loadProfiles(ctx);
        const studioIds = (profiles.studios || []).map((s) => s.id);
        const movements = await deps.repo.blockWalletMovements(ctx.userId, ctx.sanction.id);
        const storeOrders = await deps.repo.holdStoreOrders(ctx.userId, studioIds, ctx.sanction.id);
        return { movements, store_orders: storeOrders };
    },

    // Decisión del dueño: los anticipos se retienen y soporte gestiona la
    // devolución. Una alerta 'refund_needed' por cliente con sus cotizaciones.
    async refund_alerts(ctx, se) {
        const recorded = (se.steps.quotations && se.steps.quotations.quotes) || [];
        if (!recorded.length) return { alerts: 0, deposits: 0 };
        const deposits = await deps.repo.listDepositsForQuotations(recorded.map((q) => q.id));
        if (!deposits.length) return { alerts: 0, deposits: 0 };
        const quotes = await deps.repo.getQuotationsByIds([...new Set(deposits.map((d) => d.quotation_id))]);
        const byId = new Map(quotes.map((q) => [Number(q.id), q]));
        const groups = new Map();
        for (const d of deposits) {
            const quote = byId.get(Number(d.quotation_id));
            if (!quote) continue;
            const key = clientKey(quote);
            if (!groups.has(key)) {
                groups.set(key, { key, client_user_id: S.isUuid(quote.client_user_id) ? quote.client_user_id : null, client_name: S.cleanLine(quote.client_full_name, 120), quotes: [] });
            }
            groups.get(key).quotes.push({ quote_id: quote.quote_id, amount: Number(d.amount) || 0, currency: String(d.currency || '').toUpperCase().slice(0, 8), paid_on: d.paid_on || null });
        }
        const existing = await deps.repo.listAlertsForSanction('refund_needed', ctx.sanction.id);
        const done = new Set(existing.map((a) => a.payload && a.payload.client_key).filter(Boolean));
        let created = 0;
        for (const group of groups.values()) {
            if (done.has(group.key)) continue;
            const totals = {};
            for (const q of group.quotes) totals[q.currency] = (totals[q.currency] || 0) + q.amount;
            const alert = await deps.repo.createAlert({
                kind: 'refund_needed',
                status: 'open',
                subject_user_id: group.client_user_id,
                related_user_id: ctx.userId,
                payload: {
                    sanction_id: ctx.sanction.id,
                    client_key: group.key,
                    client_name: group.client_name,
                    quotes: group.quotes,
                    totals: Object.entries(totals).map(([currency, amount]) => ({ currency, amount }))
                }
            });
            created += 1;
            notifySupportAlert(alert);
        }
        return { alerts: created, deposits: deposits.length };
    },

    async identifiers(ctx) {
        if (!BanIds.isConfigured(deps.env())) {
            console.warn('[sanciones] BAN_HMAC_KEY no configurada: el cierre no guarda huellas (no habrá bloqueo de reingreso).');
            return { skipped: 'not_configured', count: 0 };
        }
        const [profiles, auth] = await Promise.all([loadProfiles(ctx), loadAuth(ctx)]);
        const list = collectIdentifiers(auth, profiles);
        const inserted = await deps.identifiersRepo.upsertIdentifiers(ctx.sanction.id, list);
        return { count: list.length, inserted: inserted.length, kinds: [...new Set(list.map((i) => i.kind))] };
    },

    async auth_ban(ctx) {
        const duration = S.authBanDuration(ctx.sanction, deps.now()) || 'permanent';
        const out = await deps.authAdmin.banAuthUser(ctx.userId, duration);
        return { ban_duration: out.ban_duration || null, not_found: Boolean(out.notFound) };
    },

    async sessions(ctx) {
        const out = await deps.authAdmin.revokeSessions(ctx.userId);
        return { revoked: out.revoked };
    },

    async notice(ctx) {
        const to = await recipientFor(ctx);
        if (!to.email) return { sent: false, reason: 'no_recipient' };
        const sanction = ctx.sanction;
        const token = S.signAppealToken(sanction, { env: deps.env(), now: deps.now() });
        const deadline = S.appealDeadline(sanction);
        const sent = await send(EVENTS.notice, {
            app_base_url: ctx.baseUrl,
            recipient_email: to.email,
            recipient_name: to.name,
            recipient_role: to.role,
            sanction_id: sanction.id,
            sanction_kind: sanction.kind,
            kind_label: S.KIND_LABELS[sanction.kind],
            reason_label: S.reasonLabel(sanction.reason_code),
            starts_at: sanction.starts_at,
            ends_at: sanction.ends_at || null,
            appeal_token: token || '',
            appeal_deadline_at: deadline ? deadline.toISOString() : ''
        }, `${EVENTS.notice}:${sanction.id}`);
        return { sent, appeal_link: Boolean(token) };
    }
};

// Aplica (o termina de aplicar) una sanción. `agent` = { userId, role } o
// null para el sistema (reingreso bloqueado).
async function applySanction(id, agent, opts = {}) {
    let sanction = await deps.repo.getSanction(id);
    if (!sanction) return fail(404, 'NOT_FOUND', 'No encontramos esa sanción.');
    if (!['proposed', ...S.EFFECTIVE_STATUSES].includes(sanction.status)) {
        return fail(409, 'NOT_APPLICABLE', 'Esta sanción ya no se puede aplicar.');
    }
    if (sanction.status === 'proposed') {
        if (!opts.system) {
            const check = S.canConfirm(sanction, agent && agent.userId);
            if (!check.ok) return check;
        }
        if (sanction.ends_at && new Date(sanction.ends_at).getTime() <= deps.now().getTime() + 60 * 1000) {
            return fail(409, 'ENDS_AT_PASSED', 'La fecha de fin de esta suspensión ya pasó. Descártala y propón una nueva.');
        }
    }
    if (!S.planApply(sanction).length) return { ok: true, sanction, steps: [] };

    const runId = crypto.randomUUID();
    const applicable = (st) => st === 'proposed' || S.EFFECTIVE_STATUSES.includes(st);
    try {
        sanction = await acquireLease(id, runId, 'apply', applicable, 'Esta sanción ya no se puede aplicar.');
    } catch (err) {
        if (isMissingSchemaError(err)) throw err;
        if (err.status === 409) return failFromConflict(err);
        throw err;
    }
    const holdsLease = (fresh) => {
        if (!leaseHeldBy(fresh, runId)) throw conflict('BUSY', BUSY_MESSAGE);
    };
    const ctx = {
        sanction, agent, userId: sanction.user_id, baseUrl: opts.baseUrl || deps.baseUrl(), note: opts.note || '', profiles: null, auth: undefined,
        commit: (mutate) => commitSideEffects(id, mutate, { check: holdsLease })
    };
    const done = [];
    try {
        for (const step of S.planApply(sanction)) {
            // Estado y turno se vuelven a comprobar antes de cada paso.
            const fresh = step === 'activate' ? sanction : await deps.repo.getSanction(id);
            if (!fresh) return fail(404, 'NOT_FOUND', 'No encontramos esa sanción.');
            if (!leaseHeldBy(fresh, runId)) return fail(409, 'BUSY', BUSY_MESSAGE, { done });
            if (step !== 'activate' && !S.EFFECTIVE_STATUSES.includes(fresh.status)) {
                return fail(409, 'CHANGED', 'La sanción cambió (se levantó o descartó) mientras la aplicábamos.', { done });
            }
            const se = S.sideEffects(fresh);
            if (se.steps[step]) continue;
            if (step !== 'activate') ctx.sanction = fresh;
            try {
                const data = await APPLY_RUNNERS[step](ctx, se);
                const doneAt = nowIso();
                sanction = await ctx.commit((cur) => {
                    cur.steps[step] = { ...(data || {}), done_at: doneAt };
                    cur.running = newLease(runId, 'apply');
                    delete cur.error;
                });
                if (step === 'activate') ctx.sanction = { ...ctx.sanction, ...sanction };
                done.push(step);
            } catch (err) {
                console.error(`[sanciones] paso ${step} de ${id} falló:`, short(err));
                if (isMissingSchemaError(err)) throw err;
                if (err.code === 'BUSY' || err.code === 'CHANGED') return fail(409, err.code, err.message, { failed_step: step, done });
                const at = nowIso();
                await ctx.commit((cur) => { cur.error = { step, at, message: short(err) }; }).catch(() => null);
                return fail(err.status === 409 ? 409 : 502, 'PARTIAL',
                    'La sanción quedó aplicada en parte. Vuelve a confirmar para terminar los pasos que faltan.',
                    { failed_step: step, done });
            }
        }
    } finally {
        await releaseLease(id, runId);
    }
    sanction = (await deps.repo.getSanction(id)) || ctx.sanction;
    if (done.length) console.log(`[sanciones] ${id} (${sanction.kind}) aplicada: ${done.join(', ')}`);
    return { ok: true, sanction, steps: done };
}

// --- propuesta ----------------------------------------------------------------------------

async function proposeSanction(input, agent, opts = {}) {
    if (!agent || !S.isUuid(agent.userId)) return fail(403, 'NO_AGENT', 'No pudimos identificar al agente.');
    if (input.user_id === agent.userId) return fail(409, 'SELF_SANCTION', 'No puedes proponer una sanción para tu propia cuenta.');
    let auth = null;
    try { auth = await deps.authAdmin.getAuthUser(input.user_id); } catch (err) {
        console.warn('[sanciones] auth lookup failed:', short(err));
        return fail(502, 'AUTH_LOOKUP', 'No pudimos comprobar la cuenta. Inténtalo de nuevo.');
    }
    if (!auth) return fail(404, 'USER_NOT_FOUND', 'No encontramos esa cuenta.');
    const pending = await deps.repo.listSanctions({ status: 'proposed', user: input.user_id });
    if (pending.some((s) => s.kind === input.kind)) {
        return fail(409, 'DUPLICATE', 'Ya hay una propuesta de este tipo para esta cuenta esperando confirmación.');
    }
    const created = await deps.repo.createSanction({
        user_id: input.user_id,
        kind: input.kind,
        reason_code: input.reason_code,
        summary: input.summary,
        ticket_id: input.ticket_id || null,
        proposed_by: agent.userId,
        status: 'proposed',
        starts_at: nowIso(),
        ends_at: input.ends_at || null,
        side_effects: {}
    });
    if (!created) return fail(500, 'CREATE_FAILED', 'No pudimos registrar la propuesta.');
    // La advertencia no necesita un segundo agente: se aplica al proponerla.
    if (created.kind === 'warning') {
        const applied = await applySanction(created.id, agent, opts);
        return applied.ok ? { ok: true, sanction: applied.sanction, applied: true } : { ...applied, sanction: created };
    }
    return { ok: true, sanction: created, applied: false };
}

// --- levantamiento ------------------------------------------------------------------------

const LIFT_RUNNERS = {
    async profile(ctx, se) {
        const rec = se.steps.profile || {};
        const id = ctx.sanction.id;
        if (rec.artist) await deps.repo.setArtistSanctionState(ctx.userId, 'none', null, { onlyIfSanction: id });
        const studios = Array.isArray(rec.studios) ? rec.studios : [];
        const wasActive = studios.filter((s) => s.was_active).map((s) => s.id);
        const wasInactive = studios.filter((s) => !s.was_active).map((s) => s.id);
        if (wasActive.length) await deps.repo.setStudiosSanctionState(wasActive, { state: 'none', sanctionId: null, isActive: true, onlyIfSanction: id });
        if (wasInactive.length) await deps.repo.setStudiosSanctionState(wasInactive, { state: 'none', sanctionId: null, onlyIfSanction: id });
        return { artist: Boolean(rec.artist), studios: studios.length };
    },

    async wallet(ctx, se) {
        const rec = se.steps.wallet || {};
        const movements = await deps.repo.unblockWalletMovements(rec.movements || [], ctx.sanction.id);
        const orders = await deps.repo.releaseStoreOrders(rec.store_orders || [], ctx.sanction.id);
        return { movements, store_orders: orders };
    },

    async identifiers(ctx) {
        const removed = await deps.identifiersRepo.deleteBySanction(ctx.sanction.id);
        return { removed };
    },

    async auth_unban(ctx) {
        // Otro cierre vigente de la misma cuenta mantiene el bloqueo.
        const others = (await deps.repo.listEffectiveSanctions(ctx.userId))
            .filter((s) => s.id !== ctx.sanction.id && s.kind === 'ban' && S.sideEffects(s).steps.auth_ban);
        if (others.length) return { skipped: 'other_ban' };
        const out = await deps.authAdmin.unbanAuthUser(ctx.userId);
        return { not_found: Boolean(out.notFound) };
    },

    async deactivate(ctx) {
        const patch = { status: 'lifted', ...(ctx.appealPatch || {}) };
        const updated = await deps.repo.updateSanction(ctx.sanction.id, patch, { expectStatus: S.EFFECTIVE_STATUSES });
        if (updated) ctx.sanction = updated;
        else {
            const current = await deps.repo.getSanction(ctx.sanction.id);
            if (!current || current.status !== 'lifted') {
                const err = new Error('La sanción cambió mientras la levantábamos.');
                err.status = 409;
                throw err;
            }
            ctx.sanction = current;
        }
        return { by: ctx.agent ? ctx.agent.userId : null, note: ctx.note || '', via: ctx.via };
    },

    async lifted_notice(ctx) {
        const to = await recipientFor(ctx);
        if (!to.email) return { sent: false, reason: 'no_recipient' };
        const sanction = ctx.sanction;
        const sent = await send(EVENTS.lifted, {
            app_base_url: ctx.baseUrl,
            recipient_email: to.email,
            recipient_name: to.name,
            recipient_role: to.role,
            sanction_id: sanction.id,
            kind_label: S.KIND_LABELS[sanction.kind],
            reason_label: S.reasonLabel(sanction.reason_code),
            lifted_via: ctx.via === 'appeal' ? 'appeal' : (ctx.via === 'expired' ? 'expired' : 'support'),
            lifted_at: nowIso()
        }, `${EVENTS.lifted}:${sanction.id}`);
        return { sent };
    },

    async reentry_exception(ctx) {
        const out = await recordReentryException(ctx.userId, ctx.agent, { sanctionId: ctx.sanction.id });
        if (!out.ok) throw new Error(out.error || 'No pudimos registrar la excepción de reingreso.');
        if (!out.stored) console.warn(`[sanciones] ${ctx.sanction.id}: falta la migración 20261118120000, la excepción de reingreso no quedó guardada`);
        return { stored: out.stored, by: ctx.agent ? ctx.agent.userId : null };
    }
};

// --- excepción del bloqueo de reingreso -----------------------------------------------------
// Al levantar un cierre por decisión de soporte o por una apelación aceptada
// (no al vencer un plazo), la cuenta queda como revisada en
// public.terms_reentry_checks (cleared_at) ANTES de desbloquearla en Auth: así
// el siguiente inicio de sesión, el barrido, el modo cliente o la validación
// de Instagram no la vuelven a cerrar por coincidir con otra cuenta
// sancionada. Las huellas de esa otra cuenta no se tocan: siguen bloqueando a
// cualquier otra cuenta. Lo mismo hace descartar una alerta de reingreso de la
// cuenta (lib/routes/sanciones.js), para el caso sin sanción que levantar.
const REENTRY_EXCEPTION_VIAS = ['support', 'appeal'];

function reentryRepo() {
    return deps.reentryRepo || require('./repos/terminos').TerminosRepo;
}

function wantsReentryException(sanction, via) {
    return Boolean(sanction) && sanction.kind === 'ban' && S.isUuid(sanction.user_id)
        && REENTRY_EXCEPTION_VIAS.includes(via || 'support');
}

// ¿La excepción quedó registrada como hecha pero sin guardar? Pasa cuando el
// código llegó antes que la migración 20261118120000: el paso se marca
// { stored: false } y sigue pendiente, para que volver a levantar (con la
// migración ya aplicada) la guarde de verdad.
function reentryExceptionPending(sanction) {
    const rec = S.sideEffects(sanction).lift.reentry_exception;
    return Boolean(rec) && rec.stored === false;
}

// Un paso del levantamiento ya hecho (la excepción sin guardar no cuenta).
function liftStepDone(se, step) {
    const rec = se.lift[step];
    if (!rec) return false;
    return !(step === 'reentry_exception' && rec.stored === false);
}

// planLift (lib/sanciones.js) + la excepción, primero.
function liftPlan(sanction, via) {
    const steps = S.planLift(sanction);
    if (wantsReentryException(sanction, via)
        && (!S.sideEffects(sanction).lift.reentry_exception || reentryExceptionPending(sanction))) {
        steps.unshift('reentry_exception');
    }
    return steps;
}

// ¿Una sanción ya levantada tiene pasos por terminar (p. ej. la excepción que
// no se pudo guardar)? Soporte la vuelve a levantar para completarlos.
function canResumeLift(sanction) {
    return Boolean(sanction) && sanction.status === 'lifted' && liftPlan(sanction, 'support').length > 0;
}

// { ok, stored } — stored:false si falta la migración. Los errores de red o
// de la base se propagan (el levantamiento queda en PARTIAL y se reintenta).
async function recordReentryException(userId, agent, { sanctionId = null, alertId = null } = {}) {
    if (!S.isUuid(userId)) return fail(400, 'INVALID_USER', 'ID de usuario inválido.');
    const out = await reentryRepo().clearReentry(userId, {
        by: agent && S.isUuid(agent.userId) ? agent.userId : null,
        sanctionId: S.isUuid(sanctionId) ? sanctionId : null,
        alertId: S.isUuid(alertId) ? alertId : null,
        at: nowIso()
    });
    return { ok: true, stored: Boolean(out && out.stored) };
}

// ¿La cuenta tiene la excepción de soporte? Ante un error, no (se compara
// como cualquier otra cuenta).
async function isReentryCleared(userId) {
    if (!S.isUuid(userId)) return false;
    try {
        return Boolean(await reentryRepo().isReentryCleared(userId));
    } catch (err) {
        console.warn('[sanciones] no se pudo leer la excepción de reingreso:', short(err));
        return false;
    }
}

// Levanta una sanción vigente (o descarta una propuesta). opts: { note, via:
// 'support' | 'appeal' | 'expired', appealPatch, baseUrl }.
async function liftSanction(id, agent, opts = {}) {
    const sanction = await deps.repo.getSanction(id);
    const check = S.canLift(sanction);
    if (!check.ok && !(sanction && sanction.status === 'lifted' && liftPlan(sanction, opts.via).length)) return check;
    if (check.ok && check.discard) {
        // Una propuesta que una corrida de "aplicar" tiene tomada no se descarta.
        if (leaseBusy(sanction, null)) return fail(409, 'BUSY', BUSY_MESSAGE);
        const updated = await deps.repo.updateSanction(id, { status: 'rejected' }, { expectStatus: 'proposed' });
        if (!updated) return fail(409, 'CHANGED', 'La propuesta cambió mientras la descartábamos. Actualiza y vuelve a intentarlo.');
        const record = { by: agent ? agent.userId : null, note: opts.note || '', via: 'discard', done_at: nowIso() };
        const saved = await commitSideEffects(id, (se) => { se.lift.deactivate = record; }).catch(() => null);
        return { ok: true, sanction: saved || updated, discarded: true, steps: ['discard'] };
    }

    const runId = crypto.randomUUID();
    const liftable = (st) => S.EFFECTIVE_STATUSES.includes(st) || st === 'lifted';
    let current;
    try {
        current = await acquireLease(id, runId, 'lift', liftable, 'Esta sanción ya no está vigente.');
    } catch (err) {
        if (isMissingSchemaError(err)) throw err;
        if (err.status === 409) return failFromConflict(err);
        throw err;
    }
    const holdsLease = (fresh) => {
        if (!leaseHeldBy(fresh, runId)) throw conflict('BUSY', BUSY_MESSAGE);
    };
    const ctx = {
        sanction: current, agent, userId: current.user_id, baseUrl: opts.baseUrl || deps.baseUrl(),
        note: opts.note || '', via: opts.via || 'support', appealPatch: opts.appealPatch || null, profiles: null, auth: undefined,
        commit: (mutate) => commitSideEffects(id, mutate, { check: holdsLease })
    };
    const done = [];
    try {
        for (const step of liftPlan(current, ctx.via)) {
            const fresh = await deps.repo.getSanction(id);
            if (!fresh) return fail(404, 'NOT_FOUND', 'No encontramos esa sanción.');
            if (!leaseHeldBy(fresh, runId)) return fail(409, 'BUSY', BUSY_MESSAGE, { done });
            if (!liftable(fresh.status)) return fail(409, 'CHANGED', 'La sanción cambió mientras la levantábamos.', { done });
            const se = S.sideEffects(fresh);
            if (liftStepDone(se, step)) continue;
            ctx.sanction = fresh;
            try {
                const data = await LIFT_RUNNERS[step](ctx, se);
                const doneAt = nowIso();
                const saved = await ctx.commit((cur) => {
                    cur.lift[step] = { ...(data || {}), done_at: doneAt };
                    cur.running = newLease(runId, 'lift');
                    delete cur.error;
                });
                ctx.sanction = { ...ctx.sanction, ...saved };
                done.push(step);
            } catch (err) {
                console.error(`[sanciones] levantar ${id}, paso ${step} falló:`, short(err));
                if (isMissingSchemaError(err)) throw err;
                if (err.code === 'BUSY' || err.code === 'CHANGED') return fail(409, err.code, err.message, { failed_step: step, done });
                const at = nowIso();
                await ctx.commit((cur) => { cur.error = { step: `lift:${step}`, at, message: short(err) }; }).catch(() => null);
                return fail(err.status === 409 ? 409 : 502, 'PARTIAL',
                    'La sanción quedó levantada en parte. Vuelve a intentarlo para terminar los pasos que faltan.',
                    { failed_step: step, done });
            }
        }
    } finally {
        await releaseLease(id, runId);
    }
    const fresh = (await deps.repo.getSanction(id)) || ctx.sanction;
    console.log(`[sanciones] ${id} levantada (${ctx.via}): ${done.join(', ')}`);
    return { ok: true, sanction: fresh, steps: done, reentry_pending: reentryExceptionPending(fresh) };
}

// --- apelación ------------------------------------------------------------------------------

async function decideAppeal(id, agent, { outcome, note } = {}, opts = {}) {
    const sanction = await deps.repo.getSanction(id);
    const check = S.canDecideAppeal(sanction, agent && agent.userId);
    if (!check.ok) return check;
    const decided = { appeal_outcome: S.APPEAL_OUTCOME_DB[outcome], appeal_decided_by: agent.userId, appeal_decided_at: nowIso() };
    if (outcome === 'lifted') {
        return liftSanction(id, agent, { ...opts, note, via: 'appeal', appealPatch: decided });
    }
    const updated = await deps.repo.updateSanction(id, { status: 'active', ...decided }, { expectStatus: 'appealed' });
    if (!updated) return fail(409, 'CHANGED', 'La apelación cambió mientras la decidías. Actualiza y vuelve a intentarlo.');
    const decision = { by: agent.userId, outcome, note: note || '', done_at: nowIso() };
    const saved = await commitSideEffects(id, (cur) => { cur.appeal_decision = decision; })
        .catch((err) => { console.warn('[sanciones] decisión de apelación sin registrar en side_effects:', short(err)); return null; });
    const se = saved ? saved.side_effects : { ...S.sideEffects(updated), appeal_decision: decision };
    const ctx = { sanction: updated, userId: updated.user_id, profiles: null, auth: undefined };
    const to = await recipientFor(ctx).catch(() => ({ email: '' }));
    if (to.email) {
        await send(EVENTS.upheld, {
            app_base_url: opts.baseUrl || deps.baseUrl(),
            recipient_email: to.email,
            recipient_name: to.name,
            recipient_role: to.role,
            sanction_id: updated.id,
            kind_label: S.KIND_LABELS[updated.kind],
            reason_label: S.reasonLabel(updated.reason_code),
            decided_at: decided.appeal_decided_at
        }, `${EVENTS.upheld}:${updated.id}`);
    }
    return { ok: true, sanction: { ...updated, side_effects: se }, steps: ['appeal_upheld'] };
}

// Resumen para /apelacion. { ok, view, sanction } | fail
async function getAppealView(token) {
    const verified = S.verifyAppealToken(token, { env: deps.env(), now: deps.now() });
    if (!verified.ok) {
        if (verified.code === 'EXPIRED') return fail(410, 'EXPIRED', 'Este enlace de apelación venció: el plazo de 30 días ya pasó.');
        if (verified.code === 'NOT_CONFIGURED') return fail(503, 'NOT_CONFIGURED', 'Las apelaciones no están disponibles en este momento. Escribe a soporte.');
        return fail(400, 'INVALID', 'El enlace de apelación no es válido. Usa el enlace del correo que te enviamos.');
    }
    const sanction = await deps.repo.getSanction(verified.sanctionId);
    if (!sanction || sanction.user_id !== verified.userId) return fail(404, 'NOT_FOUND', 'No encontramos esta sanción.');
    return { ok: true, sanction, view: S.publicSanctionView(sanction, deps.now()) };
}

async function submitAppeal({ token, text }, opts = {}) {
    const found = await getAppealView(token);
    if (!found.ok) return found;
    const { sanction } = found;
    const state = S.appealState(sanction, deps.now());
    if (state === 'already_appealed') return fail(409, 'ALREADY_APPEALED', 'Ya enviaste tu apelación. Solo se puede apelar una vez.');
    if (state === 'expired') return fail(410, 'EXPIRED', 'El plazo de 30 días para apelar ya pasó.');
    if (state !== 'open') return fail(409, 'CLOSED', 'Esta sanción ya no admite apelación.');
    const updated = await deps.repo.updateSanction(sanction.id, {
        status: 'appealed', appeal_text: text, appeal_submitted_at: nowIso()
    }, { expectStatus: 'active', appealPending: true });
    if (!updated) return fail(409, 'ALREADY_APPEALED', 'Ya enviaste tu apelación. Solo se puede apelar una vez.');
    // Aviso a soporte, sin esperar ni romper la respuesta.
    (async () => {
        const to = await supportRecipients();
        if (!to.support_email && !to.support_emails.length) return;
        await send(EVENTS.supportAppeal, {
            app_base_url: opts.baseUrl || deps.baseUrl(),
            ...to,
            sanction_id: updated.id,
            user_id: updated.user_id,
            kind_label: S.KIND_LABELS[updated.kind],
            reason_label: S.reasonLabel(updated.reason_code),
            submitted_at: updated.appeal_submitted_at
        }, `${EVENTS.supportAppeal}:${updated.id}`);
    })().catch((err) => console.warn('[sanciones] aviso de apelación no enviado:', short(err)));
    console.log(`[sanciones] apelación recibida para ${updated.id}`);
    return { ok: true, sanction: updated, view: S.publicSanctionView(updated, deps.now()) };
}

// --- alertas --------------------------------------------------------------------------------

async function updateAlert(id, agent, { status, resolution }) {
    const alert = await deps.repo.getAlert(id);
    if (!alert) return fail(404, 'NOT_FOUND', 'No encontramos esa alerta.');
    if (alert.status !== 'open') return fail(409, 'NOT_OPEN', 'Esta alerta ya fue gestionada.');
    const updated = await deps.repo.updateAlert(id, {
        status, resolution, handled_by: agent.userId, handled_at: nowIso()
    }, { expectStatus: 'open' });
    if (!updated) return fail(409, 'NOT_OPEN', 'Esta alerta ya fue gestionada.');
    return { ok: true, alert: updated };
}

// --- reingreso (contrato con T2 y T4) ------------------------------------------------------------

function fingerprintOf(identifiers) {
    const joined = identifiers.map((i) => `${i.kind}:${i.value_hmac}`).sort().join('|');
    return crypto.createHash('sha256').update(joined).digest('hex').slice(0, 32);
}

async function checkReentry({ email, phone, instagram, country, flow, userId } = {}) {
    const safeFlow = FLOW_LABELS[flow] ? flow : 'login';
    try {
        if (!BanIds.isConfigured(deps.env())) {
            BanIds.identifiersFor({}, deps.env()); // deja el aviso único en el log
            return { blocked: false, matches: [] };
        }
        const ids = BanIds.identifiersFor({ email, phone, instagram, country }, deps.env());
        if (!ids.length) return { blocked: false, matches: [] };
        let found = await deps.identifiersRepo.findMatches(ids);
        if (!found.length) return { blocked: false, matches: [] };
        // Excepción de soporte (ver liftSanction): esta cuenta ya no se bloquea
        // por las huellas de OTRA cuenta. Las huellas siguen bloqueando a las demás.
        if (S.isUuid(userId) && found.some((m) => m.sanction_user_id !== userId) && await isReentryCleared(userId)) {
            found = found.filter((m) => m.sanction_user_id === userId);
            if (!found.length) return { blocked: false, matches: [] };
        }
        const matches = found.map((m) => ({ kind: m.kind, sanction_id: m.sanction_id }));
        // La propia cuenta sancionada no es un reingreso: ya está bloqueada.
        const foreign = found.filter((m) => !userId || m.sanction_user_id !== userId);
        if (foreign.length) {
            const fingerprint = fingerprintOf(foreign);
            (async () => {
                const since = new Date(deps.now().getTime() - ALERT_DEDUPE_MS).toISOString();
                const recent = await deps.repo.findRecentOpenAlert({
                    kind: 'reentry_blocked', subjectUserId: S.isUuid(userId) ? userId : null, fingerprint, sinceIso: since
                });
                if (recent) return;
                const alert = await deps.repo.createAlert({
                    kind: 'reentry_blocked',
                    status: 'open',
                    subject_user_id: S.isUuid(userId) ? userId : null,
                    related_user_id: foreign[0].sanction_user_id || null,
                    payload: {
                        flow: safeFlow,
                        fingerprint,
                        match_kinds: [...new Set(foreign.map((m) => m.kind))],
                        sanction_ids: [...new Set(foreign.map((m) => m.sanction_id))],
                        sanction_id: foreign[0].sanction_id
                    }
                });
                await notifySupportAlert(alert);
            })().catch((err) => console.warn('[sanciones] alerta de reingreso no registrada:', short(err)));
        }
        console.warn(`[sanciones] reingreso bloqueado (${safeFlow}): ${[...new Set(matches.map((m) => m.kind))].join(',')}`);
        return { blocked: true, matches };
    } catch (err) {
        console.warn('[sanciones] checkReentry falló (falla abierta):', short(err));
        return { blocked: false, matches: [] };
    }
}

// Banea la cuenta recién creada que coincidió con una sancionada: crea una
// sanción del sistema (proposed_by null, ya activa) y aplica perfil oculto,
// bloqueo en Auth y cierre de sesiones. Soporte la ve en la pestaña Sanciones
// y puede levantarla si fue un error. Idempotente.
async function blockNewAccount({ userId, matches, flow } = {}) {
    if (!S.isUuid(userId)) return fail(400, 'INVALID_USER', 'ID de usuario inválido.');
    const sanctionIds = [...new Set((matches || []).map((m) => m && m.sanction_id).filter(S.isUuid))];
    const effective = await deps.repo.listEffectiveSanctions(userId);
    let sanction = effective.find((s) => S.sideEffects(s).source === S.REENTRY_SOURCE)
        || effective.find((s) => s.kind === 'ban');
    if (!sanction) {
        const original = sanctionIds.length ? await deps.repo.getSanction(sanctionIds[0]).catch(() => null) : null;
        if (original && original.user_id === userId) return { ok: true, sanction: original, steps: [], already: true };
        const kinds = [...new Set((matches || []).map((m) => m && m.kind).filter(Boolean))];
        sanction = await deps.repo.createSanction({
            user_id: userId,
            kind: 'ban',
            reason_code: (original && original.reason_code) || 'otro',
            summary: `Reingreso bloqueado (${FLOW_LABELS[flow] || 'registro'}): la cuenta coincide por ${matchKindsLabel(kinds) || 'un dato'} con una cuenta sancionada.`,
            proposed_by: null,
            confirmed_by: null,
            status: 'active',
            starts_at: nowIso(),
            ends_at: null,
            side_effects: { source: S.REENTRY_SOURCE, flow: FLOW_LABELS[flow] ? flow : 'login', matched_sanction_ids: sanctionIds, steps: {}, lift: {} }
        });
        if (!sanction) return fail(500, 'CREATE_FAILED', 'No pudimos registrar el bloqueo.');
    }
    return applySanction(sanction.id, null, { system: true });
}

// { id, kind, status, ends_at } | null. Solo suspensión o cierre vigentes.
async function getActiveSanction(userId) {
    if (!S.isUuid(userId)) return null;
    try {
        const rows = await deps.repo.listEffectiveSanctions(userId);
        const now = deps.now();
        const found = rows.find((s) => (s.kind === 'ban' || s.kind === 'suspension') && S.isEffective(s, now));
        return found ? { id: found.id, kind: found.kind, status: found.status, ends_at: found.ends_at || null } : null;
    } catch (err) {
        console.warn('[sanciones] getActiveSanction falló:', short(err));
        return null;
    }
}

// Levanta las suspensiones cuyo plazo terminó. Lo corre el job que arranca
// lib/routes/sanciones.js (register → cada 10 minutos) y, además, la lista de
// soporte (como mucho cada 10 minutos). Nunca corre dos veces a la vez en el
// mismo proceso; entre procesos lo protege el turno de cada sanción.
let lastExpiryRun = 0;
let expiryRunning = false;
async function liftExpiredSuspensions({ force = false } = {}) {
    const now = deps.now();
    if (expiryRunning) return { skipped: true, lifted: 0 };
    if (!force && now.getTime() - lastExpiryRun < EXPIRY_THROTTLE_MS) return { skipped: true, lifted: 0 };
    lastExpiryRun = now.getTime();
    expiryRunning = true;
    try {
        const rows = await deps.repo.listExpiredSuspensions(now.toISOString());
        let lifted = 0;
        for (const s of rows) {
            const out = await liftSanction(s.id, null, { note: 'Terminó el plazo de la suspensión.', via: 'expired' }).catch((err) => {
                if (isMissingSchemaError(err)) throw err;
                console.warn('[sanciones] no se pudo levantar una suspensión vencida:', short(err));
                return null;
            });
            if (out && out.ok) lifted += 1;
        }
        return { skipped: false, lifted };
    } finally {
        expiryRunning = false;
    }
}

module.exports = {
    checkReentry,
    blockNewAccount,
    getActiveSanction,
    proposeSanction,
    applySanction,
    liftSanction,
    canResumeLift,
    reentryExceptionPending,
    recordReentryException,
    decideAppeal,
    getAppealView,
    submitAppeal,
    updateAlert,
    liftExpiredSuspensions,
    notifySupportAlert,
    EVENTS,
    FLOW_LABELS,
    BLOCKED_MESSAGE: S.BLOCKED_MESSAGE,
    _internal: {
        setDeps, deps, collectIdentifiers, clientKey, quotationUrl, fingerprintOf, phoneWithPlus,
        APPLY_RUNNERS, LIFT_RUNNERS, commitSideEffects, LEASE_MS, liftPlan, isReentryCleared,
        resetExpiryThrottle: () => { lastExpiryRun = 0; expiryRunning = false; }
    }
};
