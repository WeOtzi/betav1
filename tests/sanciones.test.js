'use strict';

// Sanciones (2.7.0): lógica pura (lib/sanciones.js), servicio
// (lib/sanciones-service.js), repos sobre PostgREST y rutas
// (lib/routes/sanciones.js) con dependencias falsas.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const S = require('../lib/sanciones');
const BanIds = require('../lib/ban-identifiers');
const service = require('../lib/sanciones-service');
const routes = require('../lib/routes/sanciones');
const admin = require('../lib/auth/supabase-admin');
const { SancionesRepo } = require('../lib/repos/sanciones');
const { BannedIdentifiersRepo } = require('../lib/repos/banned-identifiers');

const KEY = crypto.randomBytes(32).toString('base64');
const ENV = { BAN_HMAC_KEY: KEY };
const NOW = new Date('2026-11-18T15:00:00Z');
const BASE = 'https://beta.weotzi.com';

const AGENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AGENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const NEW_USER = '99999999-9999-4999-8999-999999999999';
const STUDIO = '55555555-5555-4555-8555-555555555555';
const TICKET = '66666666-6666-4666-8666-666666666666';

let seq = 0;
const uuid = () => {
    seq += 1;
    return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

function quiet() {
    const saved = { log: console.log, warn: console.warn, error: console.error };
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    return () => Object.assign(console, saved);
}

// ---------------------------------------------------------------- mundo falso

function makeWorld(opts = {}) {
    const sanctions = new Map();
    const alerts = [];
    const identifiers = [];
    const emails = [];
    const calls = [];
    const quotes = [
        { id: 1, quote_id: 'WO-1', quote_status: 'pending', artist_id: USER, artist_name: 'Mateo', client_user_id: CLIENT, client_email: 'lucia@example.com', client_full_name: 'Lucía' },
        { id: 2, quote_id: 'WO-2', quote_status: 'in_progress', artist_id: USER, artist_name: 'Mateo', client_user_id: null, client_email: 'pedro@example.com', client_full_name: 'Pedro' },
        { id: 3, quote_id: 'WO-3', quote_status: 'completed', artist_id: USER, artist_name: 'Mateo', client_user_id: CLIENT, client_email: 'lucia@example.com', client_full_name: 'Lucía' },
        { id: 4, quote_id: 'WO-4', quote_status: 'artist_completed', artist_id: USER, artist_name: 'Mateo', client_user_id: CLIENT, client_email: 'lucia@example.com', client_full_name: 'Lucía' },
        { id: 5, quote_id: 'WO-5', quote_status: 'client_rejected', artist_id: USER, artist_name: 'Mateo', client_user_id: CLIENT, client_email: 'lucia@example.com', client_full_name: 'Lucía' }
    ];
    const deposits = [
        { id: 'd1', quotation_id: 1, quote_id: 'WO-1', amount: 100, currency: 'usd', paid_on: '2026-11-10' },
        { id: 'd2', quotation_id: 2, quote_id: 'WO-2', amount: 50, currency: 'USD', paid_on: '2026-11-11' }
    ];
    const profile = {
        artist: { id: 'a1', user_id: USER, name: 'Mateo Rivas', username: 'mateo.ink', instagram: '@Mateo.Ink', whatsapp_number: '+54 9 11 2222 3333', country: 'Argentina', sanction_state: 'none', sanction_id: null },
        client: null,
        studios: [{ id: STUDIO, name: 'Estudio Norte', slug: 'norte', instagram: 'instagram.com/estudio.norte', whatsapp: '011 15 4444-5555', country: 'Argentina', is_active: true, sanction_state: 'none', sanction_id: null }]
    };
    // Emula el trigger trg_account_sanctions_updated_at: cada UPDATE mueve updated_at.
    let tick = 0;
    const stamp = () => { tick += 1; return new Date(NOW.getTime() + tick).toISOString(); };
    const state = { artist: { ...profile.artist }, studios: profile.studios.map((s) => ({ ...s })), movements: [], orders: [], authBans: [], sessionsRevoked: [], failOnce: opts.failOnce || null };

    const repo = {
        async getActiveSupportUser(id) { return [AGENT_A, AGENT_C].includes(id) ? { user_id: id, email: 'agente@weotzi.com', full_name: id === AGENT_A ? 'Ana' : 'Carla' } : null; },
        async activeSupportEmails() { return ['agente@weotzi.com']; },
        async supportNamesByIds(ids) { return new Map(ids.filter(Boolean).map((id) => [id, id === AGENT_A ? 'Ana' : id === AGENT_C ? 'Carla' : ''])); },
        async getSanction(id) { const s = sanctions.get(id); return s ? JSON.parse(JSON.stringify(s)) : null; },
        async listSanctions({ status = 'all', user = null } = {}) {
            return [...sanctions.values()].filter((s) => (status === 'all' || s.status === status) && (!user || s.user_id === user)).map((s) => ({ ...s }));
        },
        async countByStatus() { return { proposed: [...sanctions.values()].filter((s) => s.status === 'proposed').length, appealed: 0 }; },
        async countOpenAlerts() { return alerts.filter((a) => a.status === 'open').length; },
        async listEffectiveSanctions(userId) { return [...sanctions.values()].filter((s) => s.user_id === userId && S.EFFECTIVE_STATUSES.includes(s.status)).map((s) => ({ ...s })); },
        async listExpiredSuspensions(iso) { return [...sanctions.values()].filter((s) => s.kind === 'suspension' && S.EFFECTIVE_STATUSES.includes(s.status) && s.ends_at < iso); },
        async createSanction(row) {
            const s = { id: uuid(), confirmed_by: null, appeal_text: null, appeal_submitted_at: null, appeal_decided_by: null, appeal_decided_at: null, appeal_outcome: null, created_at: NOW.toISOString(), ...row, updated_at: stamp() };
            if (s.kind === 'ban' && s.confirmed_by && s.confirmed_by === s.proposed_by) throw new Error('23514 two agents');
            sanctions.set(s.id, s);
            return { ...s };
        },
        async updateSanction(id, patch, { expectStatus = null, appealPending = false } = {}) {
            const s = sanctions.get(id);
            if (!s) return null;
            if (expectStatus && !(Array.isArray(expectStatus) ? expectStatus.includes(s.status) : s.status === expectStatus)) return null;
            if (appealPending && s.appeal_submitted_at) return null;
            const next = { ...s, ...patch, updated_at: stamp() };
            // CHECKs de la migración 20261118130000.
            if (next.kind === 'ban' && next.confirmed_by && next.proposed_by && next.confirmed_by === next.proposed_by) throw new Error('"code":"23514" ban_two_agents');
            if (next.appeal_decided_by && (next.appeal_decided_by === next.proposed_by || next.appeal_decided_by === next.confirmed_by)) throw new Error('"code":"23514" appeal_reviewer');
            if (next.appeal_outcome && !['accepted', 'rejected'].includes(next.appeal_outcome)) throw new Error('"code":"23514" appeal_outcome');
            sanctions.set(id, next);
            return { ...next };
        },
        async saveSideEffects(id, se, { expectUpdatedAt = null } = {}) {
            const s = sanctions.get(id);
            if (!s) return null;
            if (state.casFailOnce) { const fn = state.casFailOnce; state.casFailOnce = null; fn(s); }
            if (expectUpdatedAt && s.updated_at !== expectUpdatedAt) return null; // compare-and-set
            s.side_effects = JSON.parse(JSON.stringify(se));
            s.updated_at = stamp();
            return { id, status: s.status, side_effects: JSON.parse(JSON.stringify(s.side_effects)), updated_at: s.updated_at };
        },
        async accountProfiles(userId) {
            if (userId !== USER) return { artist: null, client: userId === CLIENT ? { user_id: CLIENT, full_name: 'Lucía', whatsapp: '612345678', instagram: null, country: 'ES' } : null, studios: [] };
            return { artist: { ...state.artist }, client: null, studios: state.studios.map((s) => ({ ...s })) };
        },
        async setArtistSanctionState(userId, st, sid, { onlyIfSanction = null } = {}) {
            calls.push(['artist', st, sid]);
            if (onlyIfSanction && state.artist.sanction_id !== onlyIfSanction) return [];
            Object.assign(state.artist, { sanction_state: st, sanction_id: sid });
            return [state.artist];
        },
        async setStudiosSanctionState(ids, { state: st, sanctionId, isActive, onlyIfSanction = null } = {}) {
            calls.push(['studios', ids, st, isActive]);
            for (const s of state.studios.filter((x) => ids.includes(x.id))) {
                if (onlyIfSanction && s.sanction_id !== onlyIfSanction) continue;
                Object.assign(s, { sanction_state: st, sanction_id: sanctionId });
                if (typeof isActive === 'boolean') s.is_active = isActive;
            }
            return state.studios;
        },
        async listOpenQuotationIds(userId) {
            calls.push(['open_quotes', userId]);
            return quotes.filter((q) => q.artist_id === userId && S.OPEN_QUOTE_STATUSES.includes(q.quote_status)).map((q) => q.id);
        },
        async cancelOpenQuotations(userId, ids) {
            if (state.failOnce === 'quotations') { state.failOnce = null; throw new Error('PostgREST PATCH quotations_db failed (500)'); }
            const list = ids.map(Number);
            for (const q of quotes) {
                if (q.artist_id === userId && list.includes(q.id) && S.OPEN_QUOTE_STATUSES.includes(q.quote_status)) Object.assign(q, { quote_status: 'cancelled', support_closed_reason: S.SUPPORT_CLOSED_REASON });
            }
            return quotes.filter((q) => q.artist_id === userId && list.includes(q.id) && q.quote_status === 'cancelled' && q.support_closed_reason === S.SUPPORT_CLOSED_REASON);
        },
        async getQuotationsByIds(ids) { return quotes.filter((q) => ids.map(Number).includes(q.id)); },
        async listDepositsForQuotations(ids) { return deposits.filter((d) => ids.map(Number).includes(d.quotation_id)); },
        async blockWalletMovements(userId, sid) { const m = [{ id: 'm1', status: 'processing' }]; state.movements = m; calls.push(['wallet', sid]); return m; },
        async unblockWalletMovements(records) { calls.push(['unwallet', records.length]); return records.length; },
        async holdStoreOrders(userId, studioIds) { state.orders = ['o1']; calls.push(['hold', studioIds]); return ['o1']; },
        async releaseStoreOrders(ids) { calls.push(['release', ids]); return ids.length; },
        async createAlert(row) { const a = { id: uuid(), created_at: NOW.toISOString(), resolution: null, handled_by: null, handled_at: null, ...row }; alerts.push(a); return { ...a }; },
        async listAlertsForSanction(kind, sid) { return alerts.filter((a) => a.kind === kind && a.payload.sanction_id === sid); },
        async findRecentOpenAlert({ kind, subjectUserId, fingerprint }) {
            return alerts.find((a) => a.kind === kind && a.status === 'open' && (subjectUserId ? a.subject_user_id === subjectUserId : a.payload.fingerprint === fingerprint)) || null;
        },
        async getAlert(id) { const a = alerts.find((x) => x.id === id); return a ? { ...a } : null; },
        async updateAlert(id, patch, { expectStatus } = {}) {
            const a = alerts.find((x) => x.id === id);
            if (!a || (expectStatus && a.status !== expectStatus)) return null;
            Object.assign(a, patch);
            return { ...a };
        },
        async listAlerts({ status = 'open', kind = 'all' } = {}) { return alerts.filter((a) => (status === 'all' || a.status === status) && (kind === 'all' || a.kind === kind)); },
        async searchAccounts(q) { return q === 'mateo' ? [{ user_id: USER, role: 'artist', name: 'Mateo Rivas', username: 'mateo.ink', email: 'mateo@example.com' }] : []; }
    };

    const identifiersRepo = {
        async upsertIdentifiers(sid, list) {
            const inserted = [];
            for (const i of list) {
                if (identifiers.some((x) => x.kind === i.kind && x.value_hmac === i.value_hmac)) continue; // ignore-duplicates
                const row = { id: uuid(), sanction_id: sid, ...i };
                identifiers.push(row);
                inserted.push(row);
            }
            return inserted;
        },
        async findMatches(list) {
            return identifiers.filter((x) => list.some((i) => i.kind === x.kind && i.value_hmac === x.value_hmac))
                .map((x) => ({ ...x, sanction_user_id: (sanctions.get(x.sanction_id) || {}).user_id || null }));
        },
        async deleteBySanction(sid) {
            let n = 0;
            for (let i = identifiers.length - 1; i >= 0; i -= 1) if (identifiers[i].sanction_id === sid) { identifiers.splice(i, 1); n += 1; }
            return n;
        }
    };

    const authAdmin = {
        async getAuthUser(id) {
            if (id === USER) return { id, email: 'mateo.rivas+x@gmail.com', phone: '5491122223333', full_name: 'Mateo' };
            if (id === CLIENT) return { id, email: 'lucia@example.com', phone: null, full_name: 'Lucía' };
            if (id === NEW_USER) return { id, email: 'otra@example.com', phone: null, full_name: 'Otra' };
            return null;
        },
        async banAuthUser(id, duration) { state.authReached = true; if (state.authGate) await state.authGate; state.authBans.push([id, duration]); return { ok: true, ban_duration: duration === 'permanent' ? '876000h' : `${duration}h` }; },
        async unbanAuthUser(id) { state.authBans.push([id, 'none']); return { ok: true, ban_duration: 'none' }; },
        async revokeSessions(id) { state.sessionsRevoked.push(id); return { ok: true, revoked: 2 }; }
    };

    const sendEmail = async (eventId, payload, options) => { emails.push({ eventId, payload, options }); return { ok: true }; };

    // public.terms_reentry_checks (excepción del bloqueo de reingreso).
    const reentryChecks = new Map();
    const reentryRepo = {
        async clearReentry(userId, { by, sanctionId, alertId, at }) {
            if (state.failOnce === 'reentry_exception') { state.failOnce = null; throw new Error('PostgREST POST terms_reentry_checks failed (500)'); }
            // Código desplegado antes que la migración 20261118120000.
            if (state.reentryMissing) return { stored: false, missingTable: true };
            reentryChecks.set(userId, { ...(reentryChecks.get(userId) || {}), user_id: userId, blocked: false, checked_at: at, cleared_at: at, cleared_by: by, cleared_sanction_id: sanctionId, cleared_alert_id: alertId });
            return { stored: true, missingTable: false };
        },
        async isReentryCleared(userId) { return Boolean((reentryChecks.get(userId) || {}).cleared_at); },
        // Mismo upsert que TerminosRepo.recordReentryCheck: solo estas columnas.
        async recordReentryCheck(userId, { blocked = false, checkedAt } = {}) {
            reentryChecks.set(userId, { ...(reentryChecks.get(userId) || {}), user_id: userId, blocked: Boolean(blocked), checked_at: checkedAt });
            return true;
        }
    };

    const restoreService = service._internal.setDeps({
        repo, identifiersRepo, authAdmin, sendEmail, reentryRepo, baseUrl: () => BASE, env: () => ENV, now: () => opts.now || NOW
    });
    service._internal.resetExpiryThrottle();
    const restoreRoutes = routes._internal.setDeps({
        repo,
        getAuthUser: authAdmin.getAuthUser,
        resolveBearerUser: async (req) => {
            const token = String((req.headers && req.headers.authorization) || '').replace('Bearer ', '');
            if (token === 'super') return { id: AGENT_B, email: 'isai@weotzi.com' };
            if (token === 'client') return { id: CLIENT, email: 'lucia@example.com' };
            return token ? { id: token, email: `${token}@weotzi.com` } : null;
        },
        isSuperadminEmail: (email) => email === 'isai@weotzi.com',
        applicationBase: () => BASE,
        now: () => opts.now || NOW
    });
    const restore = () => { restoreService(); restoreRoutes(); };
    return { repo, identifiersRepo, authAdmin, reentryRepo, reentryChecks, sanctions, alerts, identifiers, emails, calls, quotes, state, restore };
}

function req({ token, body, query, params } = {}) {
    return { headers: token ? { authorization: `Bearer ${token}` } : {}, body: body || {}, query: query || {}, params: params || {}, get: () => 'beta.weotzi.com' };
}

function res() {
    return {
        statusCode: 200, body: null, headers: {},
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        set(k, v) { this.headers[k] = v; return this; }
    };
}

async function call(handler, opts) {
    const r = res();
    await handler(req(opts), r);
    return r;
}

const H = routes._internal;
const AGENT = { userId: AGENT_A, role: 'support' };
const SUPER = { userId: AGENT_B, role: 'superadmin' };
const THIRD = { userId: AGENT_C, role: 'support' };

async function proposeBan(world, agent = AGENT) {
    const out = await service.proposeSanction({ user_id: USER, kind: 'ban', reason_code: 'suplantacion_identidad', summary: 'Se hace pasar por otro artista.', ticket_id: TICKET, ends_at: null }, agent);
    assert.equal(out.ok, true, out.error);
    return out.sanction;
}

// ---------------------------------------------------------------- puro

test('catálogo: tipos, estados y motivos (los 5 de denuncia + mala fe + otro)', () => {
    assert.deepEqual(S.KINDS, ['warning', 'suspension', 'ban']);
    assert.deepEqual(S.STATUSES, ['proposed', 'active', 'appealed', 'lifted', 'rejected']);
    assert.deepEqual(S.REASON_CODES, ['suplantacion_identidad', 'plagio_diseno', 'robo_propiedad_intelectual', 'difamacion', 'estafa', 'denuncia_mala_fe', 'otro']);
    for (const code of S.REASON_CODES) assert.ok(S.REASON_LABELS[code], code);
    assert.deepEqual(S.OPEN_QUOTE_STATUSES, ['pending', 'responded', 'client_approved', 'in_progress', 'en_progreso', 'expired']);
    assert.equal(S.BLOCKED_MESSAGE, 'No podemos crear esta cuenta. Si crees que es un error, escribe a soporte.');
    const front = require('../public/shared/js/support-dashboard-sanctions.js')._internal;
    assert.deepEqual(front.REASON_CODES, S.REASON_CODES, 'panel y servidor con el mismo catálogo');
    assert.deepEqual(front.REASON_LABELS, S.REASON_LABELS);
    assert.deepEqual(front.KIND_LABELS, S.KIND_LABELS);
});

test('parseProposeInput: suspensión exige fin futuro; cierre y advertencia sin fin', () => {
    const base = { user_id: USER, reason_code: 'estafa', summary: 'Cobró y no cumplió con el turno.' };
    assert.equal(S.parseProposeInput({ ...base, kind: 'ban', ends_at: '2027-01-01' }, { now: NOW }).value.ends_at, null);
    assert.equal(S.parseProposeInput({ ...base, kind: 'suspension' }, { now: NOW }).field, 'ends_at');
    assert.equal(S.parseProposeInput({ ...base, kind: 'suspension', ends_at: '2026-11-18T15:30:00Z' }, { now: NOW }).field, 'ends_at');
    assert.equal(S.parseProposeInput({ ...base, kind: 'suspension', ends_at: '2028-01-01T00:00:00Z' }, { now: NOW }).field, 'ends_at', 'máximo 365 días');
    assert.equal(S.parseProposeInput({ ...base, kind: 'suspension', ends_at: '2026-12-01T00:00:00Z' }, { now: NOW }).value.ends_at, '2026-12-01T00:00:00.000Z');
    assert.equal(S.parseProposeInput({ ...base, kind: 'otro' }).field, 'kind');
    assert.equal(S.parseProposeInput({ ...base, kind: 'ban', reason_code: 'x' }).field, 'reason_code');
    assert.equal(S.parseProposeInput({ ...base, kind: 'ban', summary: 'corto' }).field, 'summary');
    assert.equal(S.parseProposeInput({ ...base, kind: 'ban', user_id: 'nope' }).field, 'user_id');
    assert.equal(S.parseProposeInput({ ...base, kind: 'ban', ticket_id: 'nope' }).field, 'ticket_id');
    assert.equal(S.parseLiftInput({ note: 'corto' }).ok, false);
    assert.equal(S.parseAppealInput({ t: 'x', text: 'muy corto' }).field, 'text');
    assert.equal(S.parseAppealInput({ t: 'x', text: 'a'.repeat(3001) }).field, 'text');
    assert.equal(S.parseAppealDecisionInput({ outcome: 'accepted', note: 'Revisé el caso completo.' }).field, 'outcome');
    assert.equal(S.parseAppealDecisionInput({ outcome: 'lifted', note: 'Revisé el caso completo.' }).ok, true);
});

test('dos agentes: un cierre lo confirma otro agente; el superadmin cuenta como agente', () => {
    const ban = { id: uuid(), kind: 'ban', status: 'proposed', proposed_by: AGENT_A };
    assert.equal(S.canConfirm(ban, AGENT_A).code, 'SAME_AGENT');
    assert.equal(S.canConfirm(ban, AGENT_B).ok, true);
    assert.equal(S.canConfirm({ ...ban, kind: 'suspension' }, AGENT_A).ok, true, 'la suspensión la puede confirmar el mismo agente');
    assert.equal(S.canConfirm({ ...ban, status: 'active' }, AGENT_B).code, 'NOT_PROPOSED');
    assert.equal(S.canConfirm(ban, 'x').code, 'NO_AGENT');
    const appealed = { ...ban, status: 'appealed', confirmed_by: AGENT_B };
    assert.equal(S.canDecideAppeal(appealed, AGENT_A).code, 'SAME_AGENT');
    assert.equal(S.canDecideAppeal(appealed, AGENT_B).code, 'SAME_AGENT');
    assert.equal(S.canDecideAppeal(appealed, AGENT_C).ok, true);
    assert.equal(S.canDecideAppeal({ ...appealed, status: 'active' }, AGENT_C).code, 'NOT_APPEALED');
});

test('planApply: advertencia, suspensión y cierre; retoma desde side_effects', () => {
    assert.deepEqual(S.planApply({ kind: 'warning', status: 'proposed' }), ['activate', 'notice']);
    assert.deepEqual(S.planApply({ kind: 'suspension', status: 'proposed' }), ['activate', 'profile', 'notice']);
    const ban = S.planApply({ kind: 'ban', status: 'proposed' });
    assert.deepEqual(ban, ['activate', 'profile', 'quotations', 'client_notices', 'wallet', 'refund_alerts', 'identifiers', 'auth_ban', 'sessions', 'notice']);
    const suspension = S.planApply({ kind: 'suspension', status: 'proposed' });
    for (const step of ['quotations', 'identifiers', 'auth_ban', 'sessions', 'wallet']) assert.ok(!suspension.includes(step), `la suspensión no hace ${step}`);
    const resumed = S.planApply({ kind: 'ban', status: 'active', side_effects: { steps: { activate: {}, profile: {}, quotations: {} } } });
    assert.deepEqual(resumed, ['client_notices', 'wallet', 'refund_alerts', 'identifiers', 'auth_ban', 'sessions', 'notice']);
    assert.deepEqual(S.planApply({ kind: 'ban', status: 'active', side_effects: { source: 'reentry', steps: {} } }), ['profile', 'auth_ban', 'sessions']);
    // planLift solo revierte lo registrado.
    assert.deepEqual(S.planLift({ status: 'active', side_effects: { steps: { activate: {}, notice: {} } } }), ['deactivate', 'lifted_notice']);
    assert.deepEqual(S.planLift({ status: 'active', side_effects: { steps: { profile: {}, wallet: {}, identifiers: {}, auth_ban: {} } } }),
        ['profile', 'wallet', 'identifiers', 'auth_unban', 'deactivate', 'lifted_notice']);
    assert.deepEqual(S.planLift({ status: 'lifted', side_effects: { steps: { profile: {} }, lift: { profile: {}, deactivate: {} } } }), ['lifted_notice']);
});

test('token de apelación: válido, vencido, adulterado, otra clave y sin clave', () => {
    const sanction = { id: uuid(), user_id: USER, starts_at: NOW.toISOString() };
    const token = S.signAppealToken(sanction, { env: ENV, now: NOW });
    assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const ok = S.verifyAppealToken(token, { env: ENV, now: new Date('2026-12-01T00:00:00Z') });
    assert.deepEqual([ok.ok, ok.sanctionId, ok.userId], [true, sanction.id, USER]);
    assert.equal(S.verifyAppealToken(token, { env: ENV, now: new Date('2026-12-19T00:00:00Z') }).code, 'EXPIRED', '30 días desde starts_at');
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ s: sanction.id, u: CLIENT, e: 9999999999 })).toString('base64url');
    assert.equal(S.verifyAppealToken(`${forged}.${sig}`, { env: ENV, now: NOW }).code, 'INVALID');
    assert.equal(S.verifyAppealToken(`${payload}.${sig.slice(0, -2)}AA`, { env: ENV, now: NOW }).code, 'INVALID');
    assert.equal(S.verifyAppealToken(token, { env: { BAN_HMAC_KEY: crypto.randomBytes(32).toString('base64') }, now: NOW }).code, 'INVALID');
    assert.equal(S.verifyAppealToken('basura', { env: ENV, now: NOW }).code, 'INVALID');
    assert.equal(S.verifyAppealToken(token, { env: {}, now: NOW }).code, 'NOT_CONFIGURED');
    assert.equal(S.signAppealToken(sanction, { env: {}, now: NOW }), null);
    // La ventana: una sola vez y dentro de 30 días.
    const active = { ...sanction, status: 'active' };
    assert.equal(S.appealWindowOpen(active, NOW), true);
    assert.equal(S.appealWindowOpen({ ...active, appeal_submitted_at: NOW.toISOString() }, NOW), false);
    assert.equal(S.appealWindowOpen(active, new Date('2026-12-19T00:00:00Z')), false);
    assert.equal(S.appealState({ ...active, status: 'appealed', appeal_submitted_at: NOW.toISOString() }), 'already_appealed');
    assert.equal(S.appealState({ ...active, status: 'lifted' }), 'closed');
});

// ---------------------------------------------------------------- servicio

test('advertencia: se aplica al proponerla y solo manda el aviso', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const out = await service.proposeSanction({ user_id: USER, kind: 'warning', reason_code: 'difamacion', summary: 'Publicó acusaciones falsas.', ticket_id: null, ends_at: null }, AGENT);
        assert.equal(out.applied, true);
        assert.equal(out.sanction.status, 'active');
        assert.equal(out.sanction.confirmed_by, AGENT_A);
        assert.deepEqual(Object.keys(out.sanction.side_effects.steps), ['activate', 'notice']);
        assert.equal(w.state.artist.sanction_state, 'none', 'no oculta el perfil');
        assert.equal(w.state.authBans.length, 0);
        assert.equal(w.identifiers.length, 0);
        assert.deepEqual(w.emails.map((e) => e.eventId), ['account_sanction_notice']);
        const notice = w.emails[0];
        assert.equal(notice.options.idempotencyKey, `account_sanction_notice:${out.sanction.id}`);
        assert.equal(notice.options.ignorePreferences, true);
        assert.equal(notice.payload.recipient_email, 'mateo.rivas+x@gmail.com', 'el correo sale de auth.users');
        assert.equal(notice.payload.recipient_role, 'artist');
        assert.ok(S.verifyAppealToken(notice.payload.appeal_token, { env: ENV, now: NOW }).ok, 'enlace de apelación firmado');
    } finally { restoreLog(); w.restore(); }
});

test('suspensión: oculta el perfil, NO cancela cotizaciones, NO bloquea Auth, NO guarda huellas', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const out = await service.proposeSanction({ user_id: USER, kind: 'suspension', reason_code: 'plagio_diseno', summary: 'Publicó fotos de otro artista.', ticket_id: null, ends_at: '2026-12-01T00:00:00.000Z' }, AGENT);
        assert.equal(out.applied, false, 'espera confirmación');
        const applied = await service.applySanction(out.sanction.id, AGENT);
        assert.equal(applied.ok, true);
        assert.equal(w.state.artist.sanction_state, 'suspended');
        assert.equal(w.state.studios[0].sanction_state, 'suspended');
        assert.equal(w.state.studios[0].is_active, false);
        assert.equal(w.quotes.filter((q) => q.quote_status === 'cancelled').length, 0);
        assert.equal(w.state.authBans.length, 0);
        assert.equal(w.state.sessionsRevoked.length, 0);
        assert.equal(w.identifiers.length, 0);
        assert.deepEqual(w.emails.map((e) => e.eventId), ['account_sanction_notice']);
        assert.deepEqual(await service.getActiveSanction(USER), { id: out.sanction.id, kind: 'suspension', status: 'active', ends_at: '2026-12-01T00:00:00.000Z' });
    } finally { restoreLog(); w.restore(); }
});

test('cierre: el mismo agente no confirma; el superadmin sí y se aplican todos los efectos', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        const same = await service.applySanction(proposed.id, AGENT);
        assert.equal(same.code, 'SAME_AGENT');
        assert.equal(w.sanctions.get(proposed.id).status, 'proposed');

        const out = await service.applySanction(proposed.id, SUPER);
        assert.equal(out.ok, true);
        assert.equal(out.sanction.status, 'active');
        assert.equal(out.sanction.confirmed_by, AGENT_B);
        // Perfil oculto + estudio desactivado (registrado para revertir).
        assert.equal(w.state.artist.sanction_state, 'banned');
        assert.equal(w.state.artist.sanction_id, proposed.id);
        assert.deepEqual(out.sanction.side_effects.steps.profile.studios, [{ id: STUDIO, was_active: true }]);
        // Solo se cancelan las cotizaciones abiertas.
        assert.deepEqual(w.quotes.map((q) => q.quote_status), ['cancelled', 'cancelled', 'completed', 'artist_completed', 'client_rejected']);
        assert.ok(w.quotes.slice(0, 2).every((q) => q.support_closed_reason === 'El perfil fue dado de baja por soporte.'));
        // Un correo por cliente, con clave por cotización y URL armada por el servidor.
        const clientMails = w.emails.filter((e) => e.eventId === 'quotation_cancelled_profile_removed');
        assert.deepEqual(clientMails.map((e) => e.options.idempotencyKey), ['quotation_cancelled_profile_removed:WO-1', 'quotation_cancelled_profile_removed:WO-2']);
        assert.equal(clientMails[0].payload.recipient_email, 'lucia@example.com');
        assert.equal(clientMails[0].payload.quotation_url, `${BASE}/client/dashboard?quote=WO-1`);
        assert.equal(clientMails[1].payload.quotation_url, `${BASE}/my-quotations/detail?quote=WO-2`, 'sin cuenta: detalle público');
        // Billetera y Store retenidas.
        assert.deepEqual(out.sanction.side_effects.steps.wallet.movements, [{ id: 'm1', status: 'processing' }]);
        assert.deepEqual(out.sanction.side_effects.steps.wallet.store_orders, ['o1']);
        // Anticipos: una alerta 'refund_needed' por cliente con cotización, monto y moneda.
        const refunds = w.alerts.filter((a) => a.kind === 'refund_needed');
        assert.equal(refunds.length, 2);
        assert.deepEqual(refunds[0].payload.quotes, [{ quote_id: 'WO-1', amount: 100, currency: 'USD', paid_on: '2026-11-10' }]);
        assert.equal(refunds[0].subject_user_id, CLIENT);
        assert.equal(refunds[0].related_user_id, USER);
        assert.ok(!JSON.stringify(refunds).includes('@'), 'sin correos en el payload');
        const refundMails = w.emails.filter((e) => e.eventId === 'support_security_alert');
        assert.equal(refundMails.length, 2);
        // Correo específico de devolución: monto retenido, cliente y cuenta cerrada por rol.
        const refundMail = refundMails.find((e) => e.payload.alert_id === refunds[0].id);
        assert.equal(refundMail.payload.alert_kind, 'refund_needed');
        assert.match(refundMail.payload.totals_label, /^100 USD$/);
        const { renderEmail } = require('../lib/email-render');
        const rendered = renderEmail('support_security_alert', refundMail.payload);
        assert.equal(rendered.subject, 'Devolución de anticipo pendiente');
        assert.match(rendered.text, /Anticipo retenido: 100 USD/);
        assert.match(rendered.text, /Cuenta cerrada: /);
        assert.match(rendered.cta.url, /\/support\/dashboard#sanciones$/);
        // Huellas: correo y teléfono de Auth, WhatsApp e Instagram del artista y del estudio.
        const kinds = w.identifiers.map((i) => i.kind).sort();
        assert.deepEqual(kinds, ['email', 'instagram', 'instagram', 'phone', 'phone']);
        assert.ok(w.identifiers.every((i) => i.sanction_id === proposed.id && /^[0-9a-f]{64}$/.test(i.value_hmac)));
        assert.ok(w.identifiers.some((i) => i.value_hmac === BanIds.hmacIdentifier('email', 'mateorivas@gmail.com', ENV)));
        assert.ok(w.identifiers.some((i) => i.value_hmac === BanIds.hmacIdentifier('phone', '+5491122223333', ENV)), 'auth.users.phone sin + se normaliza');
        // Auth y sesiones.
        assert.deepEqual(w.state.authBans, [[USER, 'permanent']]);
        assert.deepEqual(w.state.sessionsRevoked, [USER]);
        // Aviso al sancionado (y nada al denunciante desde aquí).
        assert.equal(w.emails.filter((e) => e.eventId === 'account_sanction_notice').length, 1);
        assert.ok(!w.emails.some((e) => /report/.test(e.eventId)));
        assert.equal((await service.getActiveSanction(USER)).kind, 'ban');
    } finally { restoreLog(); w.restore(); }
});

test('cierre interrumpido: reintentar retoma desde side_effects sin repetir pasos ni correos', async () => {
    const w = makeWorld({ failOnce: 'quotations' });
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        const first = await service.applySanction(proposed.id, SUPER);
        assert.equal(first.ok, false);
        assert.equal(first.code, 'PARTIAL');
        assert.equal(first.failed_step, 'quotations');
        const saved = w.sanctions.get(proposed.id);
        assert.equal(saved.status, 'active');
        assert.deepEqual(Object.keys(saved.side_effects.steps), ['activate', 'profile']);
        assert.equal(saved.side_effects.error.step, 'quotations');
        assert.deepEqual(S.planApply(saved).slice(0, 2), ['quotations', 'client_notices']);

        const profileCalls = w.calls.filter((c) => c[0] === 'artist').length;
        const second = await service.applySanction(proposed.id, SUPER);
        assert.equal(second.ok, true);
        assert.deepEqual(second.steps, ['quotations', 'client_notices', 'wallet', 'refund_alerts', 'identifiers', 'auth_ban', 'sessions', 'notice']);
        assert.equal(w.calls.filter((c) => c[0] === 'artist').length, profileCalls, 'no repite el perfil');
        assert.equal(w.sanctions.get(proposed.id).side_effects.error, undefined);

        const third = await service.applySanction(proposed.id, SUPER);
        assert.equal(third.ok, true);
        assert.deepEqual(third.steps, [], 'nada pendiente');
        assert.equal(w.emails.filter((e) => e.eventId === 'account_sanction_notice').length, 1);
        assert.equal(w.alerts.filter((a) => a.kind === 'refund_needed').length, 2);
        // Las alertas de devolución no se duplican aunque el paso se repita.
        const se = w.sanctions.get(proposed.id).side_effects;
        delete se.steps.refund_alerts;
        await service.applySanction(proposed.id, SUPER);
        assert.equal(w.alerts.filter((a) => a.kind === 'refund_needed').length, 2);
        // Huellas: ignora duplicados.
        delete w.sanctions.get(proposed.id).side_effects.steps.identifiers;
        const before = w.identifiers.length;
        await service.applySanction(proposed.id, SUPER);
        assert.equal(w.identifiers.length, before);
    } finally { restoreLog(); w.restore(); }
});

test('levantar: revierte solo lo registrado, borra huellas y desbloquea Auth', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        await service.applySanction(proposed.id, SUPER);
        const out = await service.liftSanction(proposed.id, THIRD, { note: 'Era el titular de la cuenta.' });
        assert.equal(out.ok, true);
        assert.deepEqual(out.steps, ['reentry_exception', 'profile', 'wallet', 'identifiers', 'auth_unban', 'deactivate', 'lifted_notice']);
        assert.equal(out.sanction.status, 'lifted');
        assert.equal(w.reentryChecks.get(USER).cleared_by, AGENT_C, 'soporte deja la cuenta revisada');
        assert.equal(w.reentryChecks.get(USER).cleared_sanction_id, proposed.id);
        assert.equal(w.state.artist.sanction_state, 'none');
        assert.equal(w.state.studios[0].is_active, true, 'el estudio vuelve a estar activo');
        assert.equal(w.identifiers.length, 0);
        assert.deepEqual(w.state.authBans.at(-1), [USER, 'none']);
        assert.deepEqual(w.quotes.map((q) => q.quote_status).slice(0, 2), ['cancelled', 'cancelled'], 'las cotizaciones no se reabren');
        const lifted = w.emails.find((e) => e.eventId === 'account_sanction_lifted');
        assert.equal(lifted.options.idempotencyKey, `account_sanction_lifted:${proposed.id}`);
        assert.equal(lifted.payload.lifted_via, 'support');
        assert.equal(await service.getActiveSanction(USER), null);
        // Descartar una propuesta.
        const other = await proposeBan(w);
        const discarded = await service.liftSanction(other.id, AGENT, { note: 'No hay pruebas suficientes.' });
        assert.equal(discarded.discarded, true);
        assert.equal(w.sanctions.get(other.id).status, 'rejected');
    } finally { restoreLog(); w.restore(); }
});

test('cerrar, levantar y volver a cerrar: solo cuenta las cotizaciones de la nueva sanción (sin alertas ni avisos duplicados)', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const first = await proposeBan(w);
        assert.equal((await service.applySanction(first.id, SUPER)).ok, true);
        assert.equal((await service.liftSanction(first.id, THIRD, { note: 'Error de soporte.' })).ok, true);
        assert.equal(w.alerts.filter((a) => a.kind === 'refund_needed').length, 2);
        const clientMailsBefore = w.emails.filter((e) => e.eventId === 'quotation_cancelled_profile_removed').length;

        // Tras el levantamiento entra una cotización nueva con anticipo.
        w.quotes.push({ id: 6, quote_id: 'WO-6', quote_status: 'responded', artist_id: USER, artist_name: 'Mateo', client_user_id: null, client_email: 'nora@example.com', client_full_name: 'Nora' });
        w.repo.listDepositsForQuotations = async (ids) => [
            { id: 'd1', quotation_id: 1, quote_id: 'WO-1', amount: 100, currency: 'USD', paid_on: '2026-11-10' },
            { id: 'd2', quotation_id: 2, quote_id: 'WO-2', amount: 50, currency: 'USD', paid_on: '2026-11-11' },
            { id: 'd6', quotation_id: 6, quote_id: 'WO-6', amount: 70, currency: 'USD', paid_on: '2026-11-18' }
        ].filter((d) => ids.map(Number).includes(d.quotation_id));

        const second = await proposeBan(w);
        const out = await service.applySanction(second.id, SUPER);
        assert.equal(out.ok, true);
        const se = w.sanctions.get(second.id).side_effects;
        assert.deepEqual(se.pending_quotes.ids, [6], 'la lista fijada antes de cancelar');
        assert.deepEqual(se.steps.quotations.quotes, [{ id: 6, quote_id: 'WO-6' }], 'no arrastra las de la sanción anterior');
        const refunds = w.alerts.filter((a) => a.kind === 'refund_needed');
        assert.equal(refunds.length, 3, 'una sola alerta nueva');
        assert.deepEqual(refunds[2].payload.quotes.map((q) => q.quote_id), ['WO-6']);
        assert.equal(refunds[2].payload.sanction_id, second.id);
        const clientMails = w.emails.filter((e) => e.eventId === 'quotation_cancelled_profile_removed');
        assert.equal(clientMails.length - clientMailsBefore, 1);
        assert.equal(clientMails.at(-1).payload.quote_id, 'WO-6');
    } finally { restoreLog(); w.restore(); }
});

test('cierre interrumpido en cotizaciones: el reintento usa la lista fijada, no una nueva', async () => {
    const w = makeWorld({ failOnce: 'quotations' });
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        const first = await service.applySanction(proposed.id, SUPER);
        assert.equal(first.code, 'PARTIAL');
        assert.deepEqual(w.sanctions.get(proposed.id).side_effects.pending_quotes.ids, [1, 2]);
        // Una cotización que llega entre medio no entra en esta sanción.
        w.quotes.push({ id: 7, quote_id: 'WO-7', quote_status: 'pending', artist_id: USER, artist_name: 'Mateo', client_user_id: null, client_email: 'x@example.com', client_full_name: 'X' });
        const second = await service.applySanction(proposed.id, SUPER);
        assert.equal(second.ok, true);
        assert.equal(w.calls.filter((c) => c[0] === 'open_quotes').length, 1, 'la lista se pidió una sola vez');
        assert.deepEqual(w.sanctions.get(proposed.id).side_effects.steps.quotations.quotes.map((q) => q.quote_id), ['WO-1', 'WO-2']);
    } finally { restoreLog(); w.restore(); }
});

async function until(cond, tries = 200) {
    for (let i = 0; i < tries && !cond(); i += 1) await new Promise((r) => setImmediate(r));
    assert.ok(cond(), 'la condición no se cumplió a tiempo');
}

test('concurrencia: un levantamiento o una segunda confirmación esperan al turno de quien aplica', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        let open;
        w.state.authGate = new Promise((r) => { open = r; });
        const applying = service.applySanction(proposed.id, SUPER);
        await until(() => w.state.authReached);
        assert.equal(w.sanctions.get(proposed.id).side_effects.running.op, 'apply');

        const lift = await service.liftSanction(proposed.id, THIRD, { note: 'Levantar mientras se aplica.' });
        assert.equal(lift.ok, false);
        assert.equal(lift.status, 409);
        assert.equal(lift.code, 'BUSY');
        const retry = await service.applySanction(proposed.id, THIRD);
        assert.equal(retry.code, 'BUSY');

        w.state.authGate = null;
        open();
        const applied = await applying;
        assert.equal(applied.ok, true);
        assert.equal(w.sanctions.get(proposed.id).side_effects.running, undefined, 'suelta el turno');

        const lifted = await service.liftSanction(proposed.id, THIRD, { note: 'Ahora sí.' });
        assert.equal(lifted.ok, true);
        const se = w.sanctions.get(proposed.id).side_effects;
        assert.ok(se.steps.auth_ban && se.lift.auth_unban, 'quedan registrados el bloqueo y el desbloqueo');
        assert.deepEqual(w.state.authBans.at(-1), [USER, 'none'], 'la cuenta no queda bloqueada en Auth');
        assert.equal(w.sanctions.get(proposed.id).status, 'lifted');
    } finally { restoreLog(); w.restore(); }
});

test('concurrencia: dos confirmaciones a la vez aplican los pasos una sola vez', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        const [a, b] = await Promise.all([
            service.applySanction(proposed.id, SUPER),
            service.applySanction(proposed.id, THIRD)
        ]);
        const oks = [a, b].filter((r) => r.ok);
        const busy = [a, b].filter((r) => !r.ok);
        assert.equal(oks.length, 1);
        assert.equal(busy.length, 1);
        assert.equal(busy[0].status, 409);
        assert.equal(busy[0].code, 'BUSY');
        assert.equal(w.alerts.filter((x) => x.kind === 'refund_needed').length, 2);
        assert.equal(w.emails.filter((e) => e.eventId === 'account_sanction_notice').length, 1);
        assert.equal(w.state.authBans.length, 1);
        assert.equal(w.sanctions.get(proposed.id).status, 'active');
    } finally { restoreLog(); w.restore(); }
});

test('concurrencia: guardar side_effects mezcla sobre la versión nueva (no borra lo que otro escribió)', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        await service.applySanction(proposed.id, SUPER);
        // Otro proceso escribe entre la lectura y el guardado.
        w.state.casFailOnce = (row) => {
            row.side_effects = { ...row.side_effects, appeal_decision: { by: AGENT_C, outcome: 'upheld' } };
            row.updated_at = new Date(NOW.getTime() + 999999).toISOString();
        };
        const out = await service.liftSanction(proposed.id, THIRD, { note: 'Fin.' });
        assert.equal(out.ok, true);
        const se = w.sanctions.get(proposed.id).side_effects;
        assert.deepEqual(se.appeal_decision, { by: AGENT_C, outcome: 'upheld' });
        assert.ok(se.lift.deactivate && se.steps.notice);
    } finally { restoreLog(); w.restore(); }
});

test('concurrencia: un turno vencido (proceso caído) no bloquea para siempre', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        await service.applySanction(proposed.id, SUPER);
        const row = w.sanctions.get(proposed.id);
        row.side_effects.running = { id: 'otro', op: 'apply', until: new Date(NOW.getTime() + 60000).toISOString() };
        assert.equal((await service.liftSanction(proposed.id, THIRD)).code, 'BUSY');
        row.side_effects.running.until = new Date(NOW.getTime() - 1000).toISOString();
        const out = await service.liftSanction(proposed.id, THIRD);
        assert.equal(out.ok, true);
        assert.equal(w.sanctions.get(proposed.id).side_effects.running, undefined);
    } finally { restoreLog(); w.restore(); }
});

test('apelación: una sola vez, en plazo; la decide un tercero (se mantiene o se levanta)', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        await service.applySanction(proposed.id, SUPER);
        const token = w.emails.find((e) => e.eventId === 'account_sanction_notice').payload.appeal_token;

        const view = await service.getAppealView(token);
        assert.equal(view.ok, true);
        assert.equal(view.view.appeal_state, 'open');
        assert.equal(view.view.kind_label, 'Cierre permanente');
        assert.ok(!('summary' in view.view) && !('proposed_by' in view.view) && !('ticket_id' in view.view), 'sin datos internos');

        const sent = await service.submitAppeal({ token, text: 'Soy el titular: este es mi Instagram real y mis fechas.' });
        assert.equal(sent.ok, true);
        assert.equal(w.sanctions.get(proposed.id).status, 'appealed');
        const again = await service.submitAppeal({ token, text: 'Mando otra apelación con más detalles.' });
        assert.equal(again.code, 'ALREADY_APPEALED');
        await new Promise((r) => setImmediate(r));
        const support = w.emails.find((e) => e.eventId === 'support_appeal_received');
        assert.equal(support.options.idempotencyKey, `support_appeal_received:${proposed.id}`);
        assert.ok(!JSON.stringify(support.payload).includes('Instagram real'), 'el texto queda en el panel');

        assert.equal((await service.decideAppeal(proposed.id, AGENT, { outcome: 'upheld', note: 'Las pruebas no alcanzan.' })).code, 'SAME_AGENT');
        assert.equal((await service.decideAppeal(proposed.id, SUPER, { outcome: 'upheld', note: 'Las pruebas no alcanzan.' })).code, 'SAME_AGENT');
        const upheld = await service.decideAppeal(proposed.id, THIRD, { outcome: 'upheld', note: 'Las pruebas no alcanzan.' });
        assert.equal(upheld.ok, true);
        const row = w.sanctions.get(proposed.id);
        assert.deepEqual([row.status, row.appeal_outcome, row.appeal_decided_by], ['active', 'rejected', AGENT_C]);
        assert.equal(w.emails.filter((e) => e.eventId === 'account_sanction_appeal_upheld').length, 1);
        assert.equal((await service.submitAppeal({ token, text: 'Quiero apelar una segunda vez, por favor.' })).code, 'ALREADY_APPEALED', 'una sola apelación');

        // Otra sanción: la apelación prospera y se levanta.
        w.state.artist.sanction_state = 'none';
        const second = await proposeBan(w);
        await service.applySanction(second.id, SUPER);
        const t2 = S.signAppealToken(w.sanctions.get(second.id), { env: ENV, now: NOW });
        await service.submitAppeal({ token: t2, text: 'Soy el titular de esta cuenta desde 2019.' });
        const lifted = await service.decideAppeal(second.id, THIRD, { outcome: 'lifted', note: 'Validó su Instagram con el código.' });
        assert.equal(lifted.ok, true);
        const r2 = w.sanctions.get(second.id);
        assert.deepEqual([r2.status, r2.appeal_outcome, r2.appeal_decided_by], ['lifted', 'accepted', AGENT_C]);
        assert.equal(w.emails.filter((e) => e.eventId === 'account_sanction_lifted').at(-1).payload.lifted_via, 'appeal');
    } finally { restoreLog(); w.restore(); }
});

test('apelación vencida o con token ajeno', async () => {
    const w = makeWorld({ now: new Date('2027-01-30T00:00:00Z') });
    const restoreLog = quiet();
    try {
        const s = await w.repo.createSanction({ user_id: USER, kind: 'ban', reason_code: 'estafa', summary: 'x'.repeat(20), status: 'active', starts_at: NOW.toISOString(), proposed_by: AGENT_A, confirmed_by: AGENT_B, side_effects: {} });
        const token = S.signAppealToken(s, { env: ENV, now: NOW });
        assert.equal((await service.getAppealView(token)).code, 'EXPIRED');
        assert.equal((await service.submitAppeal({ token, text: 'Llego tarde pero quiero apelar igual.' })).status, 410);
        const otherUser = S.signAppealToken({ ...s, user_id: CLIENT, starts_at: '2027-01-29T00:00:00Z' }, { env: ENV });
        assert.equal((await service.getAppealView(otherUser)).code, 'NOT_FOUND', 'el token tiene que ser del dueño de la sanción');
    } finally { restoreLog(); w.restore(); }
});

test('reingreso: bloquea por huella, alerta a soporte sin valores en claro y falla abierta', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        await service.applySanction(proposed.id, SUPER);
        const alertsBefore = w.alerts.length;

        const clean = await service.checkReentry({ email: 'nueva@example.com', flow: 'artist' });
        assert.deepEqual(clean, { blocked: false, matches: [] });

        const hit = await service.checkReentry({ email: 'MATEO.RIVAS@gmail.com', instagram: '@mateo.ink', flow: 'client', userId: NEW_USER });
        assert.equal(hit.blocked, true);
        assert.deepEqual(hit.matches.map((m) => m.kind).sort(), ['email', 'instagram']);
        assert.ok(hit.matches.every((m) => m.sanction_id === proposed.id));
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        const alert = w.alerts.slice(alertsBefore).find((a) => a.kind === 'reentry_blocked');
        assert.ok(alert, 'alerta creada');
        assert.equal(alert.subject_user_id, NEW_USER);
        assert.equal(alert.related_user_id, USER);
        assert.deepEqual(alert.payload.match_kinds.sort(), ['email', 'instagram']);
        assert.ok(!/mateo|gmail/i.test(JSON.stringify(alert.payload)), 'sin valores ni huellas en claro');
        const mail = w.emails.find((e) => e.eventId === 'support_security_alert' && e.payload.alert_id === alert.id);
        assert.equal(mail.options.idempotencyKey, `support_security_alert:${alert.id}`);
        assert.ok(!/mateo|gmail/i.test(JSON.stringify(mail.payload)));

        // Repetir (cada inicio de sesión) no duplica la alerta.
        await service.checkReentry({ email: 'mateorivas@gmail.com', flow: 'login', userId: NEW_USER });
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        assert.equal(w.alerts.filter((a) => a.kind === 'reentry_blocked').length, 1);

        // La propia cuenta sancionada no dispara alerta de reingreso.
        const self = await service.checkReentry({ email: 'mateorivas@gmail.com', flow: 'login', userId: USER });
        assert.equal(self.blocked, true);

        // blockNewAccount: sanción del sistema, perfil oculto, Auth y sesiones. Idempotente.
        const blocked = await service.blockNewAccount({ userId: NEW_USER, matches: hit.matches, flow: 'client' });
        assert.equal(blocked.ok, true);
        const sys = blocked.sanction;
        assert.deepEqual([sys.kind, sys.status, sys.proposed_by, sys.side_effects.source], ['ban', 'active', null, 'reentry']);
        assert.ok(w.state.authBans.some(([id, d]) => id === NEW_USER && d === 'permanent'));
        assert.ok(w.state.sessionsRevoked.includes(NEW_USER));
        assert.ok(!w.emails.some((e) => e.eventId === 'account_sanction_notice' && e.payload.recipient_email === 'otra@example.com'), 'no avisa por qué');
        const again = await service.blockNewAccount({ userId: NEW_USER, matches: hit.matches, flow: 'client' });
        assert.equal(again.sanction.id, sys.id);
        assert.equal([...w.sanctions.values()].filter((s) => s.user_id === NEW_USER).length, 1);

        // Falla abierta: sin clave o con la base caída.
        const restore = service._internal.setDeps({ env: () => ({}) });
        assert.deepEqual(await service.checkReentry({ email: 'mateorivas@gmail.com' }), { blocked: false, matches: [] });
        restore();
        const restore2 = service._internal.setDeps({ identifiersRepo: { findMatches: async () => { throw new Error('down'); } } });
        assert.deepEqual(await service.checkReentry({ email: 'mateorivas@gmail.com' }), { blocked: false, matches: [] });
        restore2();
        // Levantar el cierre borra las huellas: ya no bloquea.
        await service.liftSanction(proposed.id, THIRD, { note: 'Error de identificación.' });
        assert.equal((await service.checkReentry({ email: 'mateorivas@gmail.com' })).blocked, false);
    } finally { restoreLog(); w.restore(); }
});

// ---------------------------------------------------------------- excepción de reingreso

const OTHER_USER = '77777777-7777-4777-8777-777777777777';
const silent = () => {};

// Repo de lib/routes/terminos.js: cuentas nuevas sin aceptación registrada.
function termsRepoFor(w, { pending = [] } = {}) {
    const recorded = [];
    return {
        recorded,
        listAcceptances: async () => [],
        getProfiles: async (userId) => ({ artist: null, client: { user_id: userId, instagram: '@mateo.ink' }, studios: [] }),
        insertAcceptance: async () => ({ stored: true, missingTable: false }),
        stampAllProfiles: async () => ({ artist: 0, client: 1, studio: 0 }),
        listPendingReentry: async () => pending,
        recordReentryCheck: async (userId, args) => { recorded.push({ userId, ...args }); return w.reentryRepo.recordReentryCheck(userId, args); }
    };
}

function newAccount(id, email = 'mateorivas@gmail.com') {
    return { id, email, raw: { created_at: NOW.toISOString(), phone: '', user_metadata: {} } };
}

async function statusFor(w, account) {
    const terminos = require('../lib/routes/terminos');
    const restore = terminos._internal.setDeps({ log: silent, now: () => NOW.getTime(), resolveUser: async () => account, repo: termsRepoFor(w), sanctions: service });
    try {
        const r = res();
        await terminos._internal.statusHandler({ headers: {} }, r);
        return r;
    } finally { restore(); }
}

async function flushAlerts() {
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r));
}

// Cierra a USER (huellas guardadas) y bloquea por reingreso a NEW_USER, que
// comparte correo e Instagram: el falso positivo que soporte va a levantar.
async function falsePositive(w) {
    const proposed = await proposeBan(w);
    await service.applySanction(proposed.id, SUPER);
    const hit = await service.checkReentry({ email: 'mateorivas@gmail.com', instagram: '@mateo.ink', flow: 'login', userId: NEW_USER });
    assert.equal(hit.blocked, true);
    const blocked = await service.blockNewAccount({ userId: NEW_USER, matches: hit.matches, flow: 'login' });
    assert.equal(blocked.ok, true);
    assert.equal(blocked.sanction.side_effects.source, 'reentry');
    return { original: proposed, auto: blocked.sanction };
}

test('excepción de reingreso: levantar el cierre automático deja pasar a esa cuenta (terms-status, Instagram, modo cliente); las huellas siguen bloqueando a las demás', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const { original, auto } = await falsePositive(w);
        const identifiersBefore = w.identifiers.length;
        assert.ok(identifiersBefore > 0);

        const out = await service.liftSanction(auto.id, THIRD, { note: 'Es otra persona: el Instagram lo usaba el suplantador.' });
        assert.equal(out.ok, true, out.error);
        assert.equal(out.steps[0], 'reentry_exception', 'la excepción se guarda antes de desbloquear Auth');
        assert.ok(out.steps.indexOf('reentry_exception') < out.steps.indexOf('auth_unban'));
        const row = w.reentryChecks.get(NEW_USER);
        assert.ok(row.cleared_at);
        assert.deepEqual([row.cleared_by, row.cleared_sanction_id, row.blocked], [AGENT_C, auto.id, false]);
        assert.deepEqual(w.state.authBans.at(-1), [NEW_USER, 'none']);
        assert.equal(w.identifiers.length, identifiersBefore, 'las huellas de la cuenta sancionada original no se tocan');
        assert.equal(w.sanctions.get(original.id).status, 'active');

        // Siguiente inicio de sesión: terms-status no la vuelve a cerrar.
        const status = await statusFor(w, newAccount(NEW_USER));
        assert.equal(status.statusCode, 200);
        assert.equal(status.body.blocked, false);
        assert.equal(status.body.sanction, null);
        assert.equal([...w.sanctions.values()].filter((s) => s.user_id === NEW_USER).length, 1, 'no se crea otro cierre automático');
        // Validación de Instagram y modo cliente (checkReentry con su userId).
        assert.deepEqual(await service.checkReentry({ instagram: '@mateo.ink', flow: 'instagram', userId: NEW_USER }), { blocked: false, matches: [] });
        assert.deepEqual(await service.checkReentry({ email: 'mateorivas@gmail.com', flow: 'client', userId: NEW_USER }), { blocked: false, matches: [] });

        // Cualquier otra cuenta con los mismos datos sigue bloqueada.
        const other = await service.checkReentry({ email: 'mateorivas@gmail.com', flow: 'login', userId: OTHER_USER });
        assert.equal(other.blocked, true);
        assert.ok(other.matches.every((m) => m.sanction_id === original.id));
        const otherStatus = await statusFor(w, newAccount(OTHER_USER));
        assert.equal(otherStatus.body.blocked, true);
        assert.ok([...w.sanctions.values()].some((s) => s.user_id === OTHER_USER && s.status === 'active' && S.sideEffects(s).source === 'reentry'));
        // Un alta sin cuenta todavía (precheck, finalize) no tiene excepción.
        assert.equal((await service.checkReentry({ email: 'mateorivas@gmail.com', flow: 'precheck' })).blocked, true);
        // La propia cuenta sancionada sigue bloqueada por sus huellas.
        assert.equal((await service.checkReentry({ email: 'mateorivas@gmail.com', flow: 'login', userId: USER })).blocked, true);
        await flushAlerts();
    } finally { restoreLog(); w.restore(); }
});

test('excepción de reingreso: el barrido no vuelve a cerrar la cuenta revisada ni le borra la excepción; la otra cuenta sí se cierra', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    const terminos = require('../lib/routes/terminos');
    try {
        const { auto } = await falsePositive(w);
        await service.liftSanction(auto.id, THIRD, { note: 'Es otra persona, revisado con el ticket.' });
        const row = (id) => ({ user_id: id, email: 'mateorivas@gmail.com', phone: null, created_at: NOW.toISOString(), user_metadata: { instagram: '@mateo.ink' } });
        // La RPC ya no lista cuentas con cleared_at; aunque llegara, no se cierra.
        const repo = termsRepoFor(w, { pending: [row(NEW_USER), row(OTHER_USER)] });
        const restore = terminos._internal.setDeps({ log: silent, now: () => NOW.getTime(), repo, sanctions: service });
        let out;
        try { out = await terminos._internal.sweepPendingAccounts(); } finally { restore(); }
        assert.deepEqual(out, { checked: 2, blocked: 1, skipped: false });
        assert.deepEqual(repo.recorded.map((r) => [r.userId, r.blocked]), [[NEW_USER, false], [OTHER_USER, true]]);
        assert.ok(w.reentryChecks.get(NEW_USER).cleared_at, 'el upsert del barrido no borra la excepción');
        assert.equal([...w.sanctions.values()].filter((s) => s.user_id === NEW_USER && S.EFFECTIVE_STATUSES.includes(s.status)).length, 0);
        assert.equal([...w.sanctions.values()].filter((s) => s.user_id === OTHER_USER && s.status === 'active').length, 1);
        await flushAlerts();
    } finally { restoreLog(); w.restore(); }
});

test('excepción de reingreso: si no se puede guardar, el levantamiento queda en PARTIAL con Auth bloqueado y el reintento termina', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const { auto } = await falsePositive(w);
        w.state.failOnce = 'reentry_exception';
        const first = await service.liftSanction(auto.id, THIRD, { note: 'Es otra persona.' });
        assert.equal(first.ok, false);
        assert.equal(first.code, 'PARTIAL');
        assert.equal(first.failed_step, 'reentry_exception');
        assert.equal(w.sanctions.get(auto.id).status, 'active');
        assert.ok(!w.state.authBans.some(([id, d]) => id === NEW_USER && d === 'none'), 'no desbloquea Auth sin la excepción');
        const retry = await service.liftSanction(auto.id, THIRD, { note: 'Es otra persona.' });
        assert.equal(retry.ok, true, retry.error);
        assert.equal(retry.steps[0], 'reentry_exception');
        assert.ok(w.reentryChecks.get(NEW_USER).cleared_at);
        assert.equal(w.sanctions.get(auto.id).status, 'lifted');
        // Nada más que hacer: un tercer intento no repite pasos.
        assert.equal((await service.liftSanction(auto.id, THIRD, { note: 'Otra vez.' })).ok, false);
        await flushAlerts();
    } finally { restoreLog(); w.restore(); }
});

test('excepción de reingreso sin la migración: el levantamiento la deja pendiente y volver a levantar la guarda', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const { auto } = await falsePositive(w);
        w.state.reentryMissing = true;
        const first = await service.liftSanction(auto.id, THIRD, { note: 'Es otra persona, revisado con el ticket.' });
        assert.equal(first.ok, true, first.error);
        assert.equal(first.reentry_pending, true);
        assert.equal(w.sanctions.get(auto.id).status, 'lifted');
        assert.equal(w.sanctions.get(auto.id).side_effects.lift.reentry_exception.stored, false);
        assert.equal(w.reentryChecks.has(NEW_USER), false);
        // Sin la excepción, la cuenta vuelve a coincidir: el paso sigue pendiente.
        assert.equal(service._internal.liftPlan(w.sanctions.get(auto.id), 'support')[0], 'reentry_exception');
        assert.equal(service.canResumeLift(w.sanctions.get(auto.id)), true);

        // La vista de soporte ofrece terminar de levantarla.
        const detail = await call(H.detailHandler, { token: AGENT_A, params: { id: auto.id } });
        assert.equal(detail.statusCode, 200);
        assert.equal(detail.body.sanction.can_lift, true);
        assert.equal(detail.body.sanction.effects.reentry_pending, true);
        assert.equal(detail.body.sanction.effects.reentry_cleared, false);

        // Con la migración aplicada, volver a levantar guarda la excepción y nada más.
        w.state.reentryMissing = false;
        const authBansBefore = w.state.authBans.length;
        const emailsBefore = w.emails.length;
        const retry = await call(H.liftHandler, { token: AGENT_A, params: { id: auto.id }, body: { note: 'Guardo la excepción pendiente.' } });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.deepEqual(retry.body.steps, ['reentry_exception']);
        assert.equal(retry.body.reentry_pending, false);
        assert.ok(w.reentryChecks.get(NEW_USER).cleared_at);
        assert.equal(w.reentryChecks.get(NEW_USER).cleared_sanction_id, auto.id);
        assert.equal(w.state.authBans.length, authBansBefore, 'no repite el desbloqueo');
        assert.equal(w.emails.length, emailsBefore, 'no repite el aviso');
        assert.deepEqual(await service.checkReentry({ email: 'mateorivas@gmail.com', instagram: '@mateo.ink', flow: 'login', userId: NEW_USER }), { blocked: false, matches: [] });
        assert.equal((await service.checkReentry({ email: 'mateorivas@gmail.com', flow: 'login', userId: OTHER_USER })).blocked, true, 'las huellas siguen bloqueando a las demás');
        assert.equal(service.canResumeLift(w.sanctions.get(auto.id)), false);
        assert.equal((await service.liftSanction(auto.id, THIRD, { note: 'Otra vez.' })).ok, false);
        await flushAlerts();
    } finally { restoreLog(); w.restore(); }
});

test('rutas: sin la migración, descartar una alerta de reingreso responde 503 y la alerta queda abierta', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        await service.applySanction(proposed.id, SUPER);
        assert.equal((await service.checkReentry({ instagram: '@mateo.ink', flow: 'instagram', userId: NEW_USER })).blocked, true);
        await flushAlerts();
        const alert = w.alerts.find((a) => a.kind === 'reentry_blocked' && a.subject_user_id === NEW_USER);
        assert.ok(alert);
        w.state.reentryMissing = true;
        const out = await call(H.alertUpdateHandler, { token: AGENT_A, params: { id: alert.id }, body: { status: 'dismissed', resolution: 'Falso positivo: es la titular.' } });
        assert.equal(out.statusCode, 503);
        assert.equal(out.body.code, 'MIGRATION_PENDING');
        assert.equal(out.body.error, H.REENTRY_MIGRATION_PENDING_ERROR);
        assert.equal(w.alerts.find((a) => a.id === alert.id).status, 'open');
        w.state.reentryMissing = false;
        const again = await call(H.alertUpdateHandler, { token: AGENT_A, params: { id: alert.id }, body: { status: 'dismissed', resolution: 'Falso positivo: es la titular.' } });
        assert.equal(again.statusCode, 200);
        assert.equal(again.body.reentry_cleared, true);
        assert.ok(w.reentryChecks.get(NEW_USER).cleared_at);
    } finally { restoreLog(); w.restore(); }
});

test('excepción de reingreso: solo al levantar un cierre por soporte o apelación (no suspensiones ni plazos vencidos)', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const susp = await w.repo.createSanction({ user_id: CLIENT, kind: 'suspension', reason_code: 'otro', summary: 'x'.repeat(20), status: 'active', starts_at: NOW.toISOString(), ends_at: '2026-12-01T00:00:00Z', proposed_by: AGENT_A, confirmed_by: AGENT_A, side_effects: { steps: { activate: {} } } });
        assert.equal(service._internal.liftPlan(susp, 'support').includes('reentry_exception'), false);
        const ban = { id: uuid(), user_id: NEW_USER, kind: 'ban', status: 'active', side_effects: { steps: { auth_ban: {} } } };
        assert.equal(service._internal.liftPlan(ban, 'support')[0], 'reentry_exception');
        assert.equal(service._internal.liftPlan(ban, 'appeal')[0], 'reentry_exception');
        assert.equal(service._internal.liftPlan(ban, 'expired').includes('reentry_exception'), false);
        assert.equal(service._internal.liftPlan({ ...ban, side_effects: { steps: { auth_ban: {} }, lift: { reentry_exception: { stored: true } } } }, 'support').includes('reentry_exception'), false);
        assert.equal(service._internal.liftPlan({ ...ban, side_effects: { steps: { auth_ban: {} }, lift: { reentry_exception: { stored: false } } } }, 'support')[0], 'reentry_exception', 'sin guardar sigue pendiente');
        const out = await service.liftSanction(susp.id, THIRD, { note: 'Se levantó antes.' });
        assert.equal(out.ok, true, out.error);
        assert.equal(w.reentryChecks.size, 0);
        // Sin userId válido o ante un error al leer, se compara como cualquier cuenta.
        assert.equal(await service._internal.isReentryCleared('no-es-uuid'), false);
        const restore = service._internal.setDeps({ reentryRepo: { isReentryCleared: async () => { throw new Error('base caída'); } } });
        try { assert.equal(await service._internal.isReentryCleared(NEW_USER), false); } finally { restore(); }
    } finally { restoreLog(); w.restore(); }
});

test('rutas: descartar una alerta de reingreso de una cuenta le da la excepción; gestionarla o una alerta sin cuenta, no', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        await service.applySanction(proposed.id, SUPER);
        // Validación de Instagram frenada: alerta con cuenta y sin cierre automático.
        assert.equal((await service.checkReentry({ instagram: '@mateo.ink', flow: 'instagram', userId: NEW_USER })).blocked, true);
        // Precheck sin cuenta y otra cuenta con alerta.
        await service.checkReentry({ email: 'mateorivas@gmail.com', flow: 'precheck' });
        await service.checkReentry({ email: 'mateorivas@gmail.com', flow: 'login', userId: OTHER_USER });
        await flushAlerts();
        const alertOf = (subject) => w.alerts.find((a) => a.kind === 'reentry_blocked' && a.subject_user_id === subject);
        assert.ok(alertOf(NEW_USER) && alertOf(null) && alertOf(OTHER_USER));

        const dismissed = await call(H.alertUpdateHandler, { token: AGENT_A, params: { id: alertOf(NEW_USER).id }, body: { status: 'dismissed', resolution: 'Falso positivo: es la titular del Instagram.' } });
        assert.equal(dismissed.statusCode, 200);
        assert.equal(dismissed.body.reentry_cleared, true);
        assert.equal(dismissed.body.alert.status, 'dismissed');
        assert.deepEqual([w.reentryChecks.get(NEW_USER).cleared_by, w.reentryChecks.get(NEW_USER).cleared_alert_id], [AGENT_A, alertOf(NEW_USER).id]);
        assert.deepEqual(await service.checkReentry({ instagram: '@mateo.ink', flow: 'instagram', userId: NEW_USER }), { blocked: false, matches: [] });

        const handled = await call(H.alertUpdateHandler, { token: AGENT_A, params: { id: alertOf(OTHER_USER).id }, body: { status: 'handled', resolution: 'Reingreso real: se mantiene el bloqueo.' } });
        assert.equal(handled.body.reentry_cleared, false);
        const noAccount = await call(H.alertUpdateHandler, { token: AGENT_A, params: { id: alertOf(null).id }, body: { status: 'dismissed', resolution: 'Sin cuenta: nada que hacer.' } });
        assert.equal(noAccount.body.reentry_cleared, false);
        assert.deepEqual([...w.reentryChecks.keys()], [NEW_USER]);
        assert.equal((await service.checkReentry({ email: 'mateorivas@gmail.com', flow: 'login', userId: OTHER_USER })).blocked, true);

        // Si la excepción no se guarda, la alerta sigue abierta para reintentar.
        await service.checkReentry({ email: 'mateorivas@gmail.com', flow: 'login', userId: CLIENT });
        await flushAlerts();
        w.state.failOnce = 'reentry_exception';
        const broken = await call(H.alertUpdateHandler, { token: AGENT_A, params: { id: alertOf(CLIENT).id }, body: { status: 'dismissed', resolution: 'Falso positivo.' } });
        assert.equal(broken.statusCode, 500);
        assert.equal(w.alerts.find((a) => a.id === alertOf(CLIENT).id).status, 'open');
    } finally { restoreLog(); w.restore(); }
});

test('suspensiones vencidas se levantan solas', async () => {
    const w = makeWorld({ now: new Date('2026-12-02T00:00:00Z') });
    const restoreLog = quiet();
    try {
        const s = await w.repo.createSanction({ user_id: USER, kind: 'suspension', reason_code: 'otro', summary: 'x'.repeat(20), status: 'active', starts_at: NOW.toISOString(), ends_at: '2026-12-01T00:00:00Z', proposed_by: AGENT_A, confirmed_by: AGENT_A, side_effects: { steps: { activate: {}, profile: { artist: true, studios: [] }, notice: {} } } });
        w.state.artist.sanction_state = 'suspended';
        w.state.artist.sanction_id = s.id;
        assert.equal(await service.getActiveSanction(USER), null, 'una suspensión vencida no cuenta');
        const out = await service.liftExpiredSuspensions({ force: true });
        assert.equal(out.lifted, 1);
        assert.equal(w.sanctions.get(s.id).status, 'lifted');
        assert.equal(w.state.artist.sanction_state, 'none');
        assert.equal(w.emails.find((e) => e.eventId === 'account_sanction_lifted').payload.lifted_via, 'expired');
        assert.equal(w.reentryChecks.size, 0, 'un plazo vencido no da la excepción de reingreso');
    } finally { restoreLog(); w.restore(); }
});

test('register arranca el job de suspensiones vencidas (unref, cada 10 min) y tolera la migración pendiente', async () => {
    const started = [];
    const fakeTimer = (kind) => (fn, ms) => {
        const t = { kind, fn, ms, unrefed: false, unref() { this.unrefed = true; return this; } };
        started.push(t);
        return t;
    };
    const routesSeen = [];
    const app = { get: (p) => routesSeen.push(p), post: (p) => routesSeen.push(p) };
    const calls = [];
    const restore = routes._internal.setDeps({
        service: {
            ...service,
            liftExpiredSuspensions: async (opts) => {
                calls.push(opts);
                if (calls.length === 2) throw new Error('PostgREST GET account_sanctions failed (404): {"code":"PGRST205"}');
                return { skipped: false, lifted: 1 };
            }
        }
    });
    const restoreLog = quiet();
    try {
        routes.register(app, null, { timers: { setIntervalFn: fakeTimer('interval'), setTimeoutFn: fakeTimer('timeout') } });
        assert.ok(routesSeen.includes('/api/support/sanctions'));
        const every = started.find((t) => t.kind === 'interval');
        assert.equal(every.ms, 10 * 60 * 1000);
        assert.ok(started.every((t) => t.unrefed), 'no retiene el proceso');
        assert.ok(started.some((t) => t.kind === 'timeout'), 'primera pasada poco después de arrancar');
        await every.fn();
        assert.deepEqual(calls[0], { force: true });
        assert.equal(await every.fn(), null, 'sin migración: no rompe');
        // register sin job (tests / procesos sin cron).
        started.length = 0;
        routes.register(app, null, { expiryJob: false });
        assert.equal(started.length, 0);
    } finally { routes.stopExpiryJob(); restoreLog(); restore(); }
});

// ---------------------------------------------------------------- rutas

test('rutas: solo soporte o superadmin; un cliente recibe 403', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        assert.equal((await call(H.listHandler, {})).statusCode, 401);
        assert.equal((await call(H.listHandler, { token: 'client' })).statusCode, 403);
        const ok = await call(H.listHandler, { token: AGENT_A, query: { status: 'proposed' } });
        assert.equal(ok.statusCode, 200);
        assert.equal(ok.body.reviewer.user_id, AGENT_A);
        const sup = await call(H.listHandler, { token: 'super' });
        assert.equal(sup.body.reviewer.role, 'superadmin');
        assert.equal((await call(H.listHandler, { token: AGENT_A, query: { status: 'x' } })).statusCode, 400);
    } finally { restoreLog(); w.restore(); }
});

test('rutas: proponer, confirmar con otro agente, levantar, alertas y buscador', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await call(H.proposeHandler, { token: AGENT_A, body: { user_id: USER, kind: 'ban', reason_code: 'suplantacion_identidad', summary: 'Se hace pasar por otro artista.' } });
        assert.equal(proposed.statusCode, 201);
        const id = proposed.body.sanction.id;
        assert.equal(proposed.body.sanction.mine, true);
        assert.equal(proposed.body.sanction.can_confirm, false, 'quien propone no confirma');

        const own = await call(H.confirmHandler, { token: AGENT_A, params: { id } });
        assert.equal(own.statusCode, 403);
        assert.equal(own.body.code, 'SAME_AGENT');

        const detail = await call(H.detailHandler, { token: 'super', params: { id } });
        assert.equal(detail.body.sanction.can_confirm, true);
        assert.equal(detail.body.sanction.account.email, 'mateo.rivas+x@gmail.com');

        const confirmed = await call(H.confirmHandler, { token: 'super', params: { id }, body: { note: 'Revisado con las capturas.' } });
        assert.equal(confirmed.statusCode, 200);
        assert.equal(confirmed.body.sanction.status, 'active');
        const after = await call(H.detailHandler, { token: AGENT_A, params: { id } });
        const fx = after.body.sanction.effects;
        assert.equal(fx.quotations_cancelled, 2);
        assert.equal(fx.refund_alerts, 2);
        assert.equal(fx.auth_banned, true);
        assert.equal(fx.confirm_note, 'Revisado con las capturas.');
        assert.ok(!JSON.stringify(fx).includes('@'), 'el resumen de efectos no lleva correos');

        const alerts = await call(H.alertsListHandler, { token: AGENT_A, query: { kind: 'refund_needed' } });
        assert.equal(alerts.body.alerts.length, 2);
        const alertId = alerts.body.alerts[0].id;
        assert.equal((await call(H.alertUpdateHandler, { token: AGENT_A, params: { id: alertId }, body: { status: 'open', resolution: 'x' } })).statusCode, 400);
        const handled = await call(H.alertUpdateHandler, { token: AGENT_A, params: { id: alertId }, body: { status: 'handled', resolution: 'Devolvimos el anticipo por transferencia.' } });
        assert.equal(handled.body.alert.status, 'handled');
        assert.equal(handled.body.alert.handled_by, AGENT_A);
        assert.equal((await call(H.alertUpdateHandler, { token: AGENT_A, params: { id: alertId }, body: { status: 'dismissed', resolution: 'Otra vez.' } })).statusCode, 409);

        const lifted = await call(H.liftHandler, { token: AGENT_C, params: { id }, body: { note: 'Era el titular de la cuenta.' } });
        assert.equal(lifted.body.sanction.status, 'lifted');
        assert.equal((await call(H.liftHandler, { token: AGENT_C, params: { id }, body: { note: 'Otra vez lo mismo.' } })).statusCode, 409);

        const warn = await call(H.proposeHandler, { token: AGENT_A, body: { user_id: USER, kind: 'warning', reason_code: 'difamacion', summary: 'Publicó acusaciones falsas.' } });
        assert.equal(warn.body.applied, true, 'la advertencia se aplica en el acto');

        assert.equal((await call(H.proposeHandler, { token: AGENT_A, body: { user_id: AGENT_A, kind: 'warning', reason_code: 'otro', summary: 'Probando mi propia cuenta.' } })).body.code, 'SELF_SANCTION');
        assert.equal((await call(H.proposeHandler, { token: AGENT_A, body: { user_id: '12345678-1234-4234-8234-123456789012', kind: 'warning', reason_code: 'otro', summary: 'Cuenta que no existe.' } })).statusCode, 404);

        const search = await call(H.accountsHandler, { token: AGENT_A, query: { q: 'mateo' } });
        assert.equal(search.body.accounts[0].user_id, USER);
        assert.equal((await call(H.accountsHandler, { token: AGENT_A, query: { q: 'ma' } })).statusCode, 400);
    } finally { restoreLog(); w.restore(); }
});

test('rutas: apelación pública sin sesión y decisión de un tercero', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    try {
        const proposed = await proposeBan(w);
        await service.applySanction(proposed.id, SUPER);
        const t = w.emails.find((e) => e.eventId === 'account_sanction_notice').payload.appeal_token;
        const view = await call(H.appealViewHandler, { query: { t } });
        assert.equal(view.statusCode, 200);
        assert.equal(view.headers['Cache-Control'], 'no-store');
        assert.equal(view.body.sanction.appeal_state, 'open');
        assert.equal((await call(H.appealViewHandler, { query: {} })).statusCode, 400);
        assert.equal((await call(H.appealViewHandler, { query: { t: 'abc.def' } })).statusCode, 400);

        assert.equal((await call(H.appealSubmitHandler, { body: { t, text: 'corto' } })).body.field, 'text');
        const sent = await call(H.appealSubmitHandler, { body: { t, text: 'Soy el titular de esta cuenta desde 2019.' } });
        assert.equal(sent.statusCode, 201);
        const dup = await call(H.appealSubmitHandler, { body: { t, text: 'Soy el titular de esta cuenta desde 2019.' } });
        assert.equal(dup.statusCode, 409);
        assert.equal(dup.body.code, 'ALREADY_APPEALED');

        const byProposer = await call(H.appealDecisionHandler, { token: AGENT_A, params: { id: proposed.id }, body: { outcome: 'lifted', note: 'Me equivoqué al proponerla.' } });
        assert.equal(byProposer.statusCode, 403);
        const ok = await call(H.appealDecisionHandler, { token: AGENT_C, params: { id: proposed.id }, body: { outcome: 'lifted', note: 'Validó su Instagram con el código.' } });
        assert.equal(ok.statusCode, 200);
        assert.equal(ok.body.sanction.status, 'lifted');
        assert.equal(ok.body.sanction.appeal_outcome, 'lifted');
    } finally { restoreLog(); w.restore(); }
});

test('rutas: sin la migración responden 503 MIGRATION_PENDING (o lista vacía)', async () => {
    const w = makeWorld();
    const restoreLog = quiet();
    const missing = () => { throw new Error('PostgREST GET account_sanctions failed (404): {"code":"PGRST205","message":"Could not find the table"}'); };
    const restore = routes._internal.setDeps({ repo: { ...w.repo, listSanctions: missing, getSanction: missing } });
    const restoreSvc = service._internal.setDeps({ repo: { ...w.repo, getSanction: missing } });
    try {
        const list = await call(H.listHandler, { token: AGENT_A });
        assert.equal(list.body.migration_pending, true);
        const detail = await call(H.detailHandler, { token: AGENT_A, params: { id: USER } });
        assert.equal(detail.statusCode, 503);
        assert.equal(detail.body.code, 'MIGRATION_PENDING');
        const t = S.signAppealToken({ id: USER, user_id: USER, starts_at: NOW.toISOString() }, { env: ENV, now: NOW });
        const appeal = await call(H.appealViewHandler, { query: { t } });
        assert.equal(appeal.statusCode, 503);
    } finally { restore(); restoreSvc(); restoreLog(); w.restore(); }
});

// ---------------------------------------------------------------- repos y Auth (fetch falso)

function stubFetch(handler) {
    const saved = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    process.env.SUPABASE_URL = 'https://db.example.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    const seen = [];
    globalThis.fetch = async (url, init = {}) => {
        seen.push({ url: decodeURIComponent(String(url)), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
        const out = handler(seen.at(-1)) || {};
        return {
            ok: (out.status || 200) < 400, status: out.status || 200,
            headers: { get: () => null },
            text: async () => JSON.stringify(out.body === undefined ? [] : out.body),
            json: async () => (out.body === undefined ? [] : out.body)
        };
    };
    return {
        seen,
        restore() {
            globalThis.fetch = saved.fetch;
            if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
            if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
        }
    };
}

test('repo: la cancelación es un PATCH condicional solo sobre estados abiertos', async () => {
    const f = stubFetch(({ method }) => (method === 'PATCH' ? { body: [{ id: 1 }] } : { body: [{ id: 1, quote_id: 'WO-1' }] }));
    try {
        assert.deepEqual(await SancionesRepo.cancelOpenQuotations(USER, []), [], 'sin lista no toca nada');
        assert.equal(f.seen.length, 0);
        const rows = await SancionesRepo.cancelOpenQuotations(USER, [1, 2]);
        const patch = f.seen[0];
        assert.equal(patch.method, 'PATCH');
        assert.match(patch.url, /\/rest\/v1\/quotations_db\?/);
        assert.ok(patch.url.includes(`artist_id=eq.${USER}`));
        assert.ok(patch.url.includes('id=in.("1","2")'), 'solo las cotizaciones fijadas por esta sanción');
        assert.ok(patch.url.includes('quote_status=in.("pending","responded","client_approved","in_progress","en_progreso","expired")'));
        assert.deepEqual(patch.body, { quote_status: 'cancelled', support_closed_reason: 'El perfil fue dado de baja por soporte.' });
        assert.ok(f.seen[1].url.includes('id=in.("1","2")'), 'la relectura también se limita a esa lista');
        assert.match(f.seen[1].url, /support_closed_reason=eq\.El perfil fue dado de baja por soporte\./);
        assert.deepEqual(rows, [{ id: 1, quote_id: 'WO-1' }]);
    } finally { f.restore(); }
});

test('repo: side_effects se guarda con compare-and-set sobre updated_at', async () => {
    const STAMP = '2026-11-18T15:00:00.123456+00:00';
    const f = stubFetch(() => ({ body: [] }));
    try {
        const out = await SancionesRepo.saveSideEffects(USER, { steps: {} }, { expectUpdatedAt: STAMP });
        assert.equal(out, null, 'otro la cambió: no hay fila');
        assert.equal(f.seen[0].method, 'PATCH');
        assert.ok(f.seen[0].url.includes(`updated_at=eq.${STAMP}`));
        assert.ok(f.seen[0].url.includes(`id=eq.${USER}`));
        assert.deepEqual(f.seen[0].body, { side_effects: { steps: {} } });
        const ids = await (async () => {
            f.seen.length = 0;
            return SancionesRepo.listOpenQuotationIds(USER);
        })();
        assert.deepEqual(ids, []);
        assert.ok(f.seen[0].url.includes('quote_status=in.('));
    } finally { f.restore(); }
});

test('repo: huellas con ignore-duplicates; Auth admin con ban_duration y rpc de sesiones', async () => {
    const f = stubFetch(({ url }) => {
        if (url.includes('/auth/v1/admin/users/')) return { body: { id: USER, banned_until: '2126-01-01T00:00:00Z' } };
        if (url.includes('rpc/revoke_user_sessions')) return { body: 3 };
        return { body: [{ id: 'x', kind: 'email', sanction_id: USER }] };
    });
    try {
        const hmac = 'a'.repeat(64);
        await BannedIdentifiersRepo.upsertIdentifiers(USER, [{ kind: 'email', value_hmac: hmac }, { kind: 'email', value_hmac: hmac }, { kind: 'x', value_hmac: hmac }, { kind: 'phone', value_hmac: 'nohex' }]);
        const up = f.seen[0];
        assert.equal(up.method, 'POST');
        assert.match(up.url, /banned_identifiers\?on_conflict=kind,value_hmac/);
        assert.match(up.headers.Prefer, /resolution=ignore-duplicates/);
        assert.deepEqual(up.body, [{ sanction_id: USER, kind: 'email', value_hmac: hmac }]);

        const ban = await admin.banAuthUser(USER, 'permanent');
        assert.equal(f.seen[1].method, 'PUT');
        assert.match(f.seen[1].url, new RegExp(`/auth/v1/admin/users/${USER}$`));
        assert.deepEqual(f.seen[1].body, { ban_duration: '876000h' });
        assert.equal(ban.ban_duration, '876000h');
        await admin.banAuthUser(USER, 36.2);
        assert.deepEqual(f.seen[2].body, { ban_duration: '37h' });
        await admin.unbanAuthUser(USER);
        assert.deepEqual(f.seen[3].body, { ban_duration: 'none' });
        const revoked = await admin.revokeSessions(USER);
        assert.match(f.seen[4].url, /\/rest\/v1\/rpc\/revoke_user_sessions$/);
        assert.deepEqual(f.seen[4].body, { p_user: USER });
        assert.equal(revoked.revoked, 3);
        await assert.rejects(() => admin.banAuthUser('nope', 'permanent'), /inválido/);
        await assert.rejects(() => admin.banAuthUser(USER, 0), /inválida/);
    } finally { f.restore(); }
});

test('correos: todos serverOnly, transaccionales y el del cliente con push', () => {
    const events = require('../services/email-events/sanciones');
    const { SERVER_ONLY_EVENTS } = require('../services/email-request-context');
    const push = require('../lib/push-dispatch');
    for (const id of Object.values(service.EVENTS)) {
        assert.ok(events[id], id);
        assert.equal(events[id].serverOnly, true, id);
        assert.equal(events[id].render.category, 'transactional', id);
        assert.ok(SERVER_ONLY_EVENTS.has(id), `${id} en SERVER_ONLY_EVENTS`);
    }
    assert.ok(push.PUSH_EXTRA_EVENTS.has('quotation_cancelled_profile_removed'));
    const { renderEmail } = require('../lib/email-render');
    const { fixtureFor } = require('../lib/email-render/fixtures');
    const notice = renderEmail('account_sanction_notice', fixtureFor('account_sanction_notice'));
    assert.match(notice.text, /Tienes una sola apelación, dentro de 30 días/);
    assert.match(notice.text, /Hasta: Permanente/);
    assert.match(notice.cta.url, /^https:\/\/beta\.weotzi\.com\/apelacion\?t=/);
    const noToken = renderEmail('account_sanction_notice', { ...fixtureFor('account_sanction_notice'), appeal_token: '' });
    assert.equal(noToken.cta.url, 'https://beta.weotzi.com/seguridad', 'sin clave: lleva a /seguridad');
    const client = renderEmail('quotation_cancelled_profile_removed', fixtureFor('quotation_cancelled_profile_removed'));
    assert.match(client.text, /el perfil de Mateo Rivas fue dado de baja por soporte/i);
    assert.match(client.text, /si pagaste un anticipo, soporte se comunicará contigo para gestionar la devolución/i);
    assert.doesNotMatch(client.text, /seña/i);
    const support = renderEmail('support_security_alert', fixtureFor('support_security_alert'));
    assert.equal(support.cta.url, 'https://beta.weotzi.com/support/dashboard#sanciones');
});
