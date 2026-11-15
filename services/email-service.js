// ============================================
// WE ÖTZI - EMAIL SERVICE (centralized dispatcher)
// Routes outbound emails through n8n (legacy) or BillionMail (new) based on a
// per-event feature flag stored in Supabase `app_settings.email_routing`.
// ============================================
//
// Channel values:
//   - 'n8n'         -> POST to the existing n8n webhook (preserves current behavior)
//   - 'smtp_relay'  -> render en el servidor (lib/email-render) y POST de
//                      {to, subject, html, text, headers} a UN webhook genérico
//                      de n8n (N8N_EMAIL_RELAY_URL / app_settings.email_relay_url).
//                      Un correo por destinatario; contrato en docs/N8N_EMAIL_WEBHOOKS.md.
//                      Un evento en 'n8n' SIN webhook propio sale por el relé
//                      si el relé está configurado.
//   - 'billionmail' -> POST to https://mail.weotzi.com/api/batch_mail/api/send
//   - 'dual'        -> fan-out to both channels in parallel (used during validation)
//   - 'off'         -> log + skip (no email sent)
//
// Canal por defecto: email_routing['*'].channel > EMAIL_DEFAULT_CHANNEL > 'n8n'.
//
// Per-event configuration shape (in Supabase app_settings.email_routing JSON):
//   {
//     "<eventId>": {
//       "channel": "n8n" | "billionmail" | "dual" | "off",
//       "billionmail_api_key": "<optional override; defaults to BILLIONMAIL_API_KEY env>",
//       "billionmail_sender":  "<optional override; defaults to BILLIONMAIL_DEFAULT_SENDER env>",
//       "n8n_webhook_url":     "<optional override; defaults to the URL stored in app_settings.n8n_events>"
//     }
//   }
//
// All HTTP I/O uses the global fetch available since Node 18 (server runs Node 22).

const path = require('path');
const fs = require('fs');
const eventMapping = require('./email-event-mapping');
const { dispatchOnce } = require('./email-delivery-ledger');
const notificationPrefs = require('../lib/notification-prefs');
const emailRender = require('../lib/email-render');
const { escapeHtml, safeUrl } = require('../lib/email-format');
// ── push ── cada correo a un usuario registrado dispara también su aviso push / in-app.
const pushDispatch = require('../lib/push-dispatch');

// ===== Config =====

const ROUTING_CACHE_TTL_MS = 30 * 1000;
const N8N_EVENTS_CACHE_TTL_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = parseInt(process.env.EMAIL_REQUEST_TIMEOUT_MS || process.env.BILLIONMAIL_TIMEOUT_MS || '30000', 10);

const BILLIONMAIL_API_URL = process.env.BILLIONMAIL_API_URL || 'https://bm.weotzi.com';
const BILLIONMAIL_API_KEY = process.env.BILLIONMAIL_API_KEY || '';
const BILLIONMAIL_DEFAULT_SENDER = process.env.BILLIONMAIL_DEFAULT_SENDER || 'noreply@weotzi.com';

const VALID_CHANNELS = ['n8n', 'smtp_relay', 'billionmail', 'dual', 'off'];
const DEFAULT_CHANNEL = 'n8n'; // Preserve current behavior until per-event flag is changed.
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'We Ötzi';

let _relayUrlCache = null;
let _relayUrlCacheAt = 0;

// ===== Internal cache =====

let _routingCache = null;
let _routingCacheAt = 0;
let _n8nEventsCache = null;
let _n8nEventsCacheAt = 0;
let _n8nSecretCache = null;
let _n8nSecretCacheAt = 0;

function _loadFileConfig() {
    try {
        const configPath = path.join(__dirname, '..', 'public', 'shared', 'js', 'app-config.json');
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (_) {}
    return {};
}

function _supabaseConfig() {
    const fileCfg = _loadFileConfig();
    return {
        url: process.env.SUPABASE_URL || fileCfg.supabase?.url || '',
        anonKey: process.env.SUPABASE_ANON_KEY || fileCfg.supabase?.anonKey || '',
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    };
}

async function _supabaseGetSetting(key) {
    const cfg = _supabaseConfig();
    const apiKey = cfg.serviceKey || cfg.anonKey;
    if (!cfg.url || !apiKey) return null;
    try {
        const res = await fetch(
            `${cfg.url}/rest/v1/app_settings?select=setting_value&setting_key=eq.${encodeURIComponent(key)}&limit=1`,
            {
                headers: {
                    apikey: apiKey,
                    Authorization: `Bearer ${apiKey}`
                },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            }
        );
        if (!res.ok) return null;
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows[0].setting_value;
    } catch (e) {
        console.error(`[email-service] Failed to read app_settings.${key}:`, e.message);
        return null;
    }
}

async function _supabaseUpsertSetting(key, value, settingType = 'json', description = null) {
    const cfg = _supabaseConfig();
    const apiKey = cfg.serviceKey || cfg.anonKey;
    if (!cfg.url || !apiKey) {
        return { ok: false, error: 'Supabase not configured' };
    }
    try {
        const res = await fetch(`${cfg.url}/rest/v1/app_settings?on_conflict=setting_key`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: apiKey,
                Authorization: `Bearer ${apiKey}`,
                Prefer: 'resolution=merge-duplicates'
            },
            body: JSON.stringify([
                {
                    setting_key: key,
                    setting_value: typeof value === 'string' ? value : JSON.stringify(value),
                    setting_type: settingType,
                    description,
                    is_public: false,
                    updated_at: new Date().toISOString()
                }
            ])
        });
        if (!res.ok) {
            const body = await res.text();
            return { ok: false, error: `HTTP ${res.status}: ${body}` };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Load (and memoize) the routing config object from Supabase.
 * @param {boolean} forceRefresh
 */
async function getRouting(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _routingCache && (now - _routingCacheAt) < ROUTING_CACHE_TTL_MS) {
        return _routingCache;
    }

    const raw = await _supabaseGetSetting('email_routing');
    let parsed = {};
    if (raw) {
        try {
            parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) {
            console.warn('[email-service] email_routing setting is not valid JSON, ignoring.');
            parsed = {};
        }
    }
    _routingCache = parsed && typeof parsed === 'object' ? parsed : {};
    _routingCacheAt = now;
    return _routingCache;
}

function defaultChannel(all = {}) {
    const candidates = [all['*'] && all['*'].channel, process.env.EMAIL_DEFAULT_CHANNEL, DEFAULT_CHANNEL];
    return candidates.find(c => c && VALID_CHANNELS.includes(c)) || DEFAULT_CHANNEL;
}

async function getRoutingForEvent(eventId) {
    const all = await getRouting();
    const global = all['*'] && typeof all['*'] === 'object' ? all['*'] : {};
    const entry = all[eventId] || {};
    let channel = entry.channel || defaultChannel(all);
    if (!VALID_CHANNELS.includes(channel)) channel = defaultChannel(all);
    // channel_source: 'event' si email_routing fija el canal de ESTE evento
    // (resolveChannel respeta ese override aunque el evento prefiera el relé).
    const channelSource = entry.channel && VALID_CHANNELS.includes(entry.channel) ? 'event' : 'default';
    return { ...(global.relay_url ? { relay_url: global.relay_url } : {}), ...entry, channel, channel_source: channelSource };
}

/**
 * Update the channel (and optional overrides) for one event id.
 * Useful from the backoffice UI / tests.
 */
async function updateRoutingForEvent(eventId, updates) {
    if (!eventMapping.getEvent(eventId)) {
        return { ok: false, error: `Unknown eventId: ${eventId}` };
    }
    if (updates.channel && !VALID_CHANNELS.includes(updates.channel)) {
        return { ok: false, error: `Invalid channel: ${updates.channel}` };
    }
    const current = { ...(await getRouting(true)) };
    current[eventId] = { ...(current[eventId] || {}), ...updates };
    const res = await _supabaseUpsertSetting(
        'email_routing',
        current,
        'json',
        'Per-event email channel routing (n8n / billionmail / dual / off)'
    );
    if (res.ok) {
        _routingCache = current;
        _routingCacheAt = Date.now();
    }
    return res;
}

// ===== Channel: n8n =====

async function getN8NHeaders() {
    let secret = process.env.N8N_WEBHOOK_SECRET || '';
    if (!secret) {
        if (_n8nSecretCacheAt + ROUTING_CACHE_TTL_MS < Date.now()) {
            _n8nSecretCache = await _supabaseGetSetting('n8n_webhook_secret');
            _n8nSecretCacheAt = Date.now();
        }
        secret = typeof _n8nSecretCache === 'string' ? _n8nSecretCache : '';
    }
    return { 'Content-Type': 'application/json', ...(secret ? { 'X-Weotzi-Webhook-Token': secret } : {}) };
}

async function _getN8NEventsConfig(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _n8nEventsCache && (now - _n8nEventsCacheAt) < N8N_EVENTS_CACHE_TTL_MS) {
        return _n8nEventsCache;
    }

    let events = null;
    const fromDb = await _supabaseGetSetting('n8n_events');
    if (fromDb) {
        try {
            events = typeof fromDb === 'string' ? JSON.parse(fromDb) : fromDb;
        } catch (_) {}
    }
    if (!Array.isArray(events)) {
        const fileCfg = _loadFileConfig();
        events = Array.isArray(fileCfg.n8n?.events) ? fileCfg.n8n.events : [];
    }
    _n8nEventsCache = events;
    _n8nEventsCacheAt = now;
    return events;
}

async function _resolveN8NWebhook(eventId, override) {
    if (override && typeof override === 'string' && override.trim()) return override.trim();
    const events = await _getN8NEventsConfig();
    const found = events.find(e => e && e.id === eventId);
    if (found && found.webhookUrl && found.enabled !== false) return found.webhookUrl;
    return '';
}

async function sendViaN8N(eventId, payload, override = {}) {
    const url = await _resolveN8NWebhook(eventId, override.n8n_webhook_url);
    if (!url) {
        return { ok: false, channel: 'n8n', error: 'No hay webhook de n8n ni relé de email configurado para este correo (N8N_EMAIL_RELAY_URL).' };
    }

    const event = eventMapping.getEvent(eventId);
    const body = {
        event_id: eventId,
        event_name: event?.name || eventId,
        timestamp: new Date().toISOString(),
        source: 'weotzi-app',
        // EM-N4: las plantillas de n8n interpolan {{ $json.body.data.* }} sin
        // escapar, así que todo valor de texto viaja ya escapado y las URLs
        // validadas. Los datos de salud no salen nunca.
        data: escapeForTemplate(payload || {})
    };
    // Destinatario y variables de plantilla ya resueltos (mismo contrato que
    // BillionMail): los flujos de n8n nuevos usan body.to / body.vars y los
    // viejos siguen leyendo body.data. body.rendered trae el correo armado en
    // el servidor (asunto, HTML y texto) para migrar los nodos al layout común.
    try {
        const recipients = eventMapping.resolveRecipients(eventId, payload || {});
        if (recipients.length) body.to = recipients.join(', ');
        body.vars = escapeForTemplate(eventMapping.buildAttribs(eventId, payload || {}));
    } catch (_) {}
    try {
        const rendered = emailRender.renderEmail(eventId, payload || {});
        body.rendered = { subject: rendered.subject, html: rendered.html, text: rendered.text, headers: rendered.headers };
    } catch (_) {}

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: await getN8NHeaders(),
            body: JSON.stringify(body),
            signal: ctrl.signal
        });
        return await providerResult(res, 'n8n');
    } catch (e) {
        return { ok: false, channel: 'n8n', uncertain: true, error: 'No se pudo confirmar la respuesta del proveedor de correo.' };
    } finally {
        clearTimeout(t);
    }
}

/**
 * Copia segura para plantillas que interpolan sin escapar (n8n / BillionMail):
 * strings escapados, claves *_url / *_link validadas (https) y sin datos de salud.
 */
function escapeForTemplate(value, key = '', depth = 0) {
    if (depth > 4) return null;
    if (value === undefined || value === null) return value;
    if (typeof value === 'string') {
        if (/(?:_url|_link)$/.test(key) || key === 'url') return safeUrl(value) ? escapeHtml(safeUrl(value)) : '';
        return escapeHtml(value);
    }
    if (Array.isArray(value)) return value.map(item => escapeForTemplate(item, '', depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (eventMapping.SENSITIVE_ATTRIBS.has(k)) continue;
            out[k] = escapeForTemplate(v, k, depth + 1);
        }
        return out;
    }
    return value;
}

// ===== Channel: smtp_relay (render en servidor + webhook genérico de n8n) =====

async function _resolveRelayUrl(routing = {}) {
    const candidates = [routing.relay_url, process.env.N8N_EMAIL_RELAY_URL];
    for (const candidate of candidates) {
        if (candidate && safeUrl(String(candidate))) return String(candidate).trim();
    }
    if (_relayUrlCacheAt + ROUTING_CACHE_TTL_MS < Date.now()) {
        const stored = await _supabaseGetSetting('email_relay_url');
        _relayUrlCache = typeof stored === 'string' ? stored.replace(/^"|"$/g, '').trim() : '';
        _relayUrlCacheAt = Date.now();
    }
    return _relayUrlCache && safeUrl(_relayUrlCache) ? _relayUrlCache : '';
}

async function isRelayConfigured(routing = {}) {
    return !!(await _resolveRelayUrl(routing));
}

async function getRelayHeaders() {
    const own = process.env.N8N_EMAIL_RELAY_TOKEN || '';
    if (own) return { 'Content-Type': 'application/json', 'X-Weotzi-Webhook-Token': own };
    return getN8NHeaders();
}

/**
 * Un correo a UN destinatario por el relé.
 * @param {{ to: string, role?: string, timezone?: string, idempotencyKey?: string }} target
 */
async function sendViaRelay(eventId, payload, routing = {}, target = {}) {
    const url = await _resolveRelayUrl(routing);
    if (!url) {
        return { ok: false, channel: 'smtp_relay', error: 'No hay relé de email configurado (N8N_EMAIL_RELAY_URL o app_settings.email_relay_url).' };
    }
    if (!target.to) return { ok: false, channel: 'smtp_relay', error: 'No hay un destinatario válido guardado para este correo.' };
    let rendered;
    try {
        rendered = emailRender.renderEmail(eventId, payload || {}, { role: target.role, timezone: target.timezone });
    } catch (error) {
        console.error(`[email-service] render ${eventId} falló:`, error.message);
        return { ok: false, channel: 'smtp_relay', error: 'No se pudo armar el correo.' };
    }
    const event = eventMapping.getEvent(eventId);
    const body = {
        event_id: eventId,
        event_name: event?.name || eventId,
        category: rendered.category,
        role: rendered.role,
        from_name: EMAIL_FROM_NAME,
        to: target.to,
        ...(process.env.SUPPORT_EMAIL ? { reply_to: process.env.SUPPORT_EMAIL } : {}),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: { ...rendered.headers, 'X-Weotzi-Event': eventId },
        ...(target.idempotencyKey ? { idempotency_key: target.idempotencyKey } : {})
    };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: await getRelayHeaders(),
            body: JSON.stringify(body),
            signal: ctrl.signal
        });
        return await providerResult(res, 'smtp_relay');
    } catch (e) {
        return { ok: false, channel: 'smtp_relay', uncertain: true, error: 'No se pudo confirmar la respuesta del proveedor de correo.' };
    } finally {
        clearTimeout(t);
    }
}

/** Zona horaria guardada del destinatario (user_preferences.app_settings.timezone). */
async function _recipientTimezone(recipient, deps = {}) {
    if (!recipient || !recipient.user_id) return '';
    try {
        const query = deps.query || require('../lib/postgrest').pgrest;
        const row = await query('user_preferences').select('app_settings').eq('user_id', recipient.user_id).limit(1).single().execute();
        const tz = row && row.app_settings && row.app_settings.timezone;
        return typeof tz === 'string' ? tz : '';
    } catch (_) {
        return '';
    }
}

/**
 * Envío por el relé: un correo por destinatario (con su rol, sus links, su
 * zona horaria y sus preferencias) y una clave de idempotencia por cada uno.
 */
async function sendRelayEmail(eventId, payload, routing, options = {}) {
    const roles = eventMapping.resolveRecipientRoles(eventId, payload);
    const event = eventMapping.getEvent(eventId);
    const audience = (event && event.render && event.render.audience) || emailRender.getSpec(eventId)?.audience;
    const targets = roles.length
        ? roles
        : eventMapping.resolveRecipients(eventId, payload).map((email, index) => ({
            role: payload.recipient_role || audience, email, index,
            user_id: payload.recipient_user_id || null
        }));
    if (!targets.length) return { ok: false, channel: 'smtp_relay', error: 'No hay un destinatario válido guardado para este correo.' };

    const results = [];
    for (const target of targets) {
        if (!options.ignorePreferences) {
            const gate = await notificationPrefs.allowRecipient(eventId, target, options.prefsDeps || {});
            if (!gate.allowed) {
                console.log(`[email-service] eventId=${eventId} role=${target.role} skipped by notification_prefs (${gate.kind})`);
                results.push({ ok: true, channel: 'none', skipped: true, sent: false, delivery_status: 'skipped_by_preference', role: target.role });
                continue;
            }
        }
        const timezone = target.timezone || await _recipientTimezone(target, options.prefsDeps || {});
        const suffix = roles.length ? target.role : (targets.length > 1 ? `to${target.index}` : '');
        const key = options.idempotencyKey ? (suffix ? `${options.idempotencyKey}:${suffix}` : options.idempotencyKey) : '';
        const send = () => sendViaRelay(eventId, payload, routing, { to: target.email, role: target.role, timezone, idempotencyKey: key || undefined });
        const result = key ? await dispatchOnce(eventId, key, send, options.ledgerQuery) : await send();
        results.push({ ...result, role: target.role });
    }
    return aggregateResults(eventId, results);
}

function aggregateResults(eventId, results) {
    if (results.length === 1) {
        const { role, ...single } = results[0];
        return single;
    }
    const sent = results.filter(r => r.ok && !r.skipped);
    const skipped = results.filter(r => r.skipped && r.ok);
    const failed = results.filter(r => !r.ok);
    const ok = failed.length === 0;
    return {
        ok,
        channel: 'smtp_relay',
        skipped: ok && sent.length === 0 && skipped.length > 0,
        partial: !ok && (sent.length > 0 || skipped.length > 0),
        uncertain: failed.some(r => r.uncertain),
        deduplicated: results.every(r => r.deduplicated),
        delivery_status: ok ? (sent.length ? 'smtp_accepted' : 'skipped_by_preference') : undefined,
        results: results.map(({ role, ok: rOk, skipped: rSkipped, delivery_status, deduplicated, uncertain, error }) =>
            ({ role, ok: rOk, skipped: !!rSkipped, delivery_status, deduplicated: !!deduplicated, uncertain: !!uncertain, ...(error ? { error } : {}) })),
        ...(ok ? {} : { error: failed.map(r => `${r.role}: ${r.error || 'falló'}`).join(' | ') })
    };
}

// ===== Channel: BillionMail =====

async function sendViaBillionMail(eventId, payload, override = {}) {
    const apiKey = override.billionmail_api_key || BILLIONMAIL_API_KEY;
    const apiUrl = (override.billionmail_api_url || BILLIONMAIL_API_URL).replace(/\/$/, '');
    const sender = override.billionmail_sender || BILLIONMAIL_DEFAULT_SENDER;

    if (!apiKey) {
        return { ok: false, channel: 'billionmail', error: 'BILLIONMAIL_API_KEY not set' };
    }

    const recipients = eventMapping.resolveRecipients(eventId, payload);
    if (recipients.length === 0) {
        return {
            ok: false,
            channel: 'billionmail',
            error: 'No hay un email de destino para este correo.'
        };
    }

    const attribs = eventMapping.buildAttribs(eventId, payload);
    // Track template hint as a special attrib so the BillionMail panel can route by template
    // if/when that feature is configured at the campaign level.
    const event = eventMapping.getEvent(eventId);
    if (event?.templateHint) attribs.template_hint = event.templateHint;
    attribs.event_id = eventId;

    const url = `${apiUrl}/api/batch_mail/api/${recipients.length > 1 ? 'batch_send' : 'send'}`;
    const body = recipients.length > 1
        ? { recipients, addresser: sender, attribs }
        : { recipient: recipients[0], addresser: sender, attribs };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify(body),
            signal: ctrl.signal
        });
        return { ...(await providerResult(res, 'billionmail')), recipients };
    } catch (e) {
        return { ok: false, channel: 'billionmail', uncertain: true, error: 'No se pudo confirmar la respuesta del proveedor de correo.', recipients };
    } finally {
        clearTimeout(t);
    }
}

// ===== Public API =====

async function providerResult(res, channel) {
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) {}
    const results = Array.isArray(body) ? body : [body];
    if (!res.ok || results.some(row => row?.success === false || row?.ok === false || row?.status === false || row?.error || row?.code < 0 || (Array.isArray(row?.rejected) && row.rejected.length))) {
        // A workflow may fail after one branch already sent. Only explicit HTTP
        // rejection before execution is safe to retry without inspecting n8n.
        const uncertain = res.status >= 500 || res.status === 408 ||
            results.some(row => row?.messageId || row?.accepted?.length) ||
            ((channel === 'n8n' || channel === 'smtp_relay') && res.ok);
        return { ok: false, channel, status: res.status, uncertain,
            error: uncertain ? 'El proveedor no pudo confirmar todos los correos. Requiere verificación antes de reenviar.' : `El proveedor rechazó el correo (HTTP ${res.status}).` };
    }
    if (/<(?:!doctype|html)\b/i.test(text)) {
        return { ok: false, channel, status: res.status, error: 'El proveedor devolvió una página web en lugar de confirmar el correo.' };
    }
    const messageIds = results.map(row => row?.messageId).filter(Boolean);
    const smtpChannel = channel === 'n8n' || channel === 'smtp_relay';
    if (smtpChannel && !messageIds.length) {
        return { ok: false, channel, status: res.status, uncertain: true,
            error: 'El proveedor no confirmó la aceptación SMTP del correo. No se reenvió automáticamente.' };
    }
    // EM-01: un flujo que manda varios correos responde un array; si alguno
    // no trae messageId, el envío quedó a medias y no se puede reintentar solo.
    if (smtpChannel && messageIds.length < results.length) {
        return { ok: false, channel, status: res.status, uncertain: true, partial: true,
            error: 'El proveedor confirmó solo parte de los correos. Requiere verificación antes de reenviar.' };
    }
    return { ok: true, channel, status: res.status, delivery_status: messageIds.length ? 'smtp_accepted' : 'accepted',
        ...(messageIds.length ? { message_id: String(messageIds[0]) } : {}) };
}

/**
 * Dispatch an email event.
 * @param {string} eventId
 * @param {Object} payload   Free-form event data; mapped to attribs by event-mapping.
 * @param {Object} [options]
 * @param {string} [options.forceChannel] Override the configured channel for this call.
 * @returns {Promise<{ok: boolean, channel: string, results?: Array, error?: string}>}
 */
async function sendEmail(eventId, payload, options = {}) {
    if (!eventMapping.getEvent(eventId)) {
        const err = `Unknown eventId: ${eventId}`;
        console.warn(`[email-service] ${err}`);
        return { ok: false, channel: 'none', error: err };
    }
    if (!eventMapping.resolveRecipients(eventId, payload).length) {
        return { ok: false, channel: 'none', error: 'No hay un destinatario válido guardado para este correo.' };
    }

    // ── push ── aviso push / in-app del mismo evento (preferencia "Push" propia,
    // sin esperar al correo ni a su canal; nunca rompe ni demora el envío).
    try { pushDispatch.onEmailEvent(eventId, payload, options); } catch (_) { /* aviso secundario */ }

    const routing = options.routing || await getRoutingForEvent(eventId);
    const channel = options.channel || await resolveChannel(eventId, routing, options);

    if (channel === 'off') {
        console.log(`[email-service] eventId=${eventId} channel=off (skipped)`);
        return { ok: false, channel: 'off', skipped: true, delivery_status: 'disabled', error: 'El envío de este correo está desactivado.' };
    }

    // Relé: render en el servidor, un correo por destinatario, con sus
    // preferencias y su propia clave de idempotencia (EM-09 / EM-01).
    if (channel === 'smtp_relay' && !options.claimed) {
        const startedAt = Date.now();
        const result = await sendRelayEmail(eventId, payload, routing, options);
        logResult(eventId, channel, result, Date.now() - startedAt);
        return result;
    }

    // Preferencias de notificaciones del artista y del cliente: si apagó
    // este aviso por email, no se le envía (o se lo saca de un envío doble).
    if (!options.ignorePreferences) {
        const gate = await notificationPrefs.applyEmailPreferences(eventId, payload, {
            resolveRecipients: eventMapping.resolveRecipients,
            ...(options.prefsDeps || {})
        });
        if (gate.skip) {
            console.log(`[email-service] eventId=${eventId} skipped by notification_prefs (${gate.kind})`);
            return { ok: true, channel: 'none', skipped: true, sent: false,
                delivery_status: 'skipped_by_preference', reason: gate.reason };
        }
        payload = gate.payload;
    }

    if (options.idempotencyKey && !options.claimed) {
        return dispatchOnce(eventId, options.idempotencyKey,
            () => sendEmail(eventId, payload, { ...options, routing, channel, claimed: true, ignorePreferences: true }),
            options.ledgerQuery);
    }

    const startedAt = Date.now();
    let result;

    if (channel === 'smtp_relay') {
        result = await sendRelayEmail(eventId, payload, routing, { ...options, idempotencyKey: undefined, ignorePreferences: true });
    } else if (channel === 'n8n') {
        result = await sendViaN8N(eventId, payload, routing);
    } else if (channel === 'billionmail') {
        result = await sendViaBillionMail(eventId, payload, routing);
    } else if (channel === 'dual') {
        const [n8nRes, bmRes] = await Promise.all([
            sendViaN8N(eventId, payload, routing),
            sendViaBillionMail(eventId, payload, routing)
        ]);
        const ok = n8nRes.ok && bmRes.ok;
        result = {
            ok,
            channel: 'dual',
            partial: n8nRes.ok !== bmRes.ok,
            uncertain: !!(n8nRes.uncertain || bmRes.uncertain),
            results: [n8nRes, bmRes],
            error: !ok ? `n8n: ${n8nRes.error || 'ok'} | billionmail: ${bmRes.error || 'ok'}` : undefined
        };
    } else {
        result = { ok: false, channel, error: `Invalid channel: ${channel}` };
    }

    logResult(eventId, channel, result, Date.now() - startedAt);
    return result;
}

function logResult(eventId, channel, result, durationMs) {
    if (result.ok) {
        console.log(`[email-service] eventId=${eventId} channel=${channel} ${result.skipped ? 'skipped' : 'ok'} in ${durationMs}ms`);
    } else {
        console.warn(`[email-service] eventId=${eventId} channel=${channel} FAILED in ${durationMs}ms: ${result.error}`);
    }
}

/**
 * Canal efectivo: forceChannel > email_routing > default. Un evento en 'n8n'
 * que no tiene webhook propio sale por el relé si está configurado (así
 * instagram_verification_code, studio_*, inbox y recordatorios no se pierden).
 * Un evento con preferRelay (su flujo n8n duplica un aviso que el servidor ya
 * manda) sale por el relé si está configurado, salvo que email_routing fije
 * el canal de ese evento (routing.channel_source === 'event').
 */
async function resolveChannel(eventId, routing, options = {}) {
    if (options.forceChannel && VALID_CHANNELS.includes(options.forceChannel)) return options.forceChannel;
    routing = routing || {};
    let channel = routing.channel || DEFAULT_CHANNEL;
    if (channel === 'n8n') {
        const event = eventMapping.getEvent(eventId);
        const preferRelay = !!(event && event.preferRelay) && routing.channel_source !== 'event';
        if (preferRelay && await isRelayConfigured(routing)) return 'smtp_relay';
        const hook = await _resolveN8NWebhook(eventId, routing.n8n_webhook_url);
        if (!hook && await isRelayConfigured(routing)) channel = 'smtp_relay';
    }
    return channel;
}

/**
 * Snapshot of routing + event metadata for the backoffice UI.
 */
async function getEventsWithRouting() {
    const routing = await getRouting(true);
    const events = eventMapping.listEvents();
    return events.map(ev => ({
        ...ev,
        channel: routing[ev.id]?.channel || defaultChannel(routing),
        relay_url: routing[ev.id]?.relay_url || null,
        billionmail_sender: routing[ev.id]?.billionmail_sender || null,
        has_billionmail_api_key: !!routing[ev.id]?.billionmail_api_key,
        n8n_webhook_url: routing[ev.id]?.n8n_webhook_url || null
    }));
}

module.exports = {
    sendEmail,
    getRouting,
    getRoutingForEvent,
    updateRoutingForEvent,
    getEventsWithRouting,
    sendViaN8N,
    sendViaBillionMail,
    sendViaRelay,
    sendRelayEmail,
    resolveChannel,
    isRelayConfigured,
    escapeForTemplate,
    aggregateResults,
    providerResult,
    getN8NHeaders,
    eventMapping,
    VALID_CHANNELS,
    DEFAULT_CHANNEL
};
