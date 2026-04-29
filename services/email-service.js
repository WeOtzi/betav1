// ============================================
// WE ÖTZI - EMAIL SERVICE (centralized dispatcher)
// Routes outbound emails through n8n (legacy) or BillionMail (new) based on a
// per-event feature flag stored in Supabase `app_settings.email_routing`.
// ============================================
//
// Channel values:
//   - 'n8n'         -> POST to the existing n8n webhook (preserves current behavior)
//   - 'billionmail' -> POST to https://mail.weotzi.com/api/batch_mail/api/send
//   - 'dual'        -> fan-out to both channels in parallel (used during validation)
//   - 'off'         -> log + skip (no email sent)
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

// ===== Config =====

const ROUTING_CACHE_TTL_MS = 30 * 1000;
const N8N_EVENTS_CACHE_TTL_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = parseInt(process.env.BILLIONMAIL_TIMEOUT_MS || '15000', 10);

const BILLIONMAIL_API_URL = process.env.BILLIONMAIL_API_URL || 'https://bm.weotzi.com';
const BILLIONMAIL_API_KEY = process.env.BILLIONMAIL_API_KEY || '';
const BILLIONMAIL_DEFAULT_SENDER = process.env.BILLIONMAIL_DEFAULT_SENDER || 'noreply@weotzi.com';

const VALID_CHANNELS = ['n8n', 'billionmail', 'dual', 'off'];
const DEFAULT_CHANNEL = 'n8n'; // Preserve current behavior until per-event flag is changed.

// ===== Internal cache =====

let _routingCache = null;
let _routingCacheAt = 0;
let _n8nEventsCache = null;
let _n8nEventsCacheAt = 0;

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
    if (!cfg.url || !cfg.anonKey) return null;
    try {
        const res = await fetch(
            `${cfg.url}/rest/v1/app_settings?select=setting_value&setting_key=eq.${encodeURIComponent(key)}&limit=1`,
            {
                headers: {
                    apikey: cfg.anonKey,
                    Authorization: `Bearer ${cfg.anonKey}`
                }
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
                    is_public: true,
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

async function getRoutingForEvent(eventId) {
    const all = await getRouting();
    const entry = all[eventId] || {};
    let channel = entry.channel || DEFAULT_CHANNEL;
    if (!VALID_CHANNELS.includes(channel)) channel = DEFAULT_CHANNEL;
    return { ...entry, channel };
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
    const current = await getRouting(true);
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
        return { ok: false, channel: 'n8n', error: 'No n8n webhook URL configured' };
    }

    const event = eventMapping.getEvent(eventId);
    const body = {
        event_id: eventId,
        event_name: event?.name || eventId,
        timestamp: new Date().toISOString(),
        source: 'weotzi-app',
        data: payload || {}
    };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            return {
                ok: false,
                channel: 'n8n',
                status: res.status,
                error: `HTTP ${res.status}${text ? ': ' + text.slice(0, 200) : ''}`
            };
        }
        return { ok: true, channel: 'n8n', status: res.status };
    } catch (e) {
        return { ok: false, channel: 'n8n', error: e.message };
    } finally {
        clearTimeout(t);
    }
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
            error: 'Could not resolve a recipient email address from payload'
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
        const text = await res.text().catch(() => '');
        if (!res.ok) {
            return {
                ok: false,
                channel: 'billionmail',
                status: res.status,
                error: `HTTP ${res.status}${text ? ': ' + text.slice(0, 200) : ''}`,
                recipients
            };
        }
        return { ok: true, channel: 'billionmail', status: res.status, recipients };
    } catch (e) {
        return { ok: false, channel: 'billionmail', error: e.message, recipients };
    } finally {
        clearTimeout(t);
    }
}

// ===== Public API =====

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

    const routing = await getRoutingForEvent(eventId);
    const channel = options.forceChannel && VALID_CHANNELS.includes(options.forceChannel)
        ? options.forceChannel
        : routing.channel;

    const startedAt = Date.now();
    let result;

    if (channel === 'off') {
        console.log(`[email-service] eventId=${eventId} channel=off (skipped)`);
        return { ok: true, channel: 'off', skipped: true };
    }

    if (channel === 'n8n') {
        result = await sendViaN8N(eventId, payload, routing);
    } else if (channel === 'billionmail') {
        result = await sendViaBillionMail(eventId, payload, routing);
    } else if (channel === 'dual') {
        const [n8nRes, bmRes] = await Promise.all([
            sendViaN8N(eventId, payload, routing),
            sendViaBillionMail(eventId, payload, routing)
        ]);
        const ok = n8nRes.ok || bmRes.ok; // Either succeeding is enough during validation
        result = {
            ok,
            channel: 'dual',
            results: [n8nRes, bmRes],
            error: !ok ? `n8n: ${n8nRes.error || 'ok'} | billionmail: ${bmRes.error || 'ok'}` : undefined
        };
    } else {
        result = { ok: false, channel, error: `Invalid channel: ${channel}` };
    }

    const durationMs = Date.now() - startedAt;
    if (result.ok) {
        console.log(
            `[email-service] eventId=${eventId} channel=${channel} ok in ${durationMs}ms`
        );
    } else {
        console.warn(
            `[email-service] eventId=${eventId} channel=${channel} FAILED in ${durationMs}ms: ${result.error}`
        );
    }
    return result;
}

/**
 * Snapshot of routing + event metadata for the backoffice UI.
 */
async function getEventsWithRouting() {
    const routing = await getRouting(true);
    const events = eventMapping.listEvents();
    return events.map(ev => ({
        ...ev,
        channel: routing[ev.id]?.channel || DEFAULT_CHANNEL,
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
    eventMapping,
    VALID_CHANNELS,
    DEFAULT_CHANNEL
};
