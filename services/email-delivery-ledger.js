'use strict';

const crypto = require('node:crypto');
const { pgrest } = require('../lib/postgrest');

function deliveryKey(eventId, identity) {
    return crypto.createHash('sha256').update(`${eventId}:${identity}`).digest('hex');
}

async function dispatchOnce(eventId, identity, send, query = pgrest) {
    const key = deliveryKey(eventId, identity);
    try {
        await query('email_delivery_ledger').insert({ delivery_key: key, event_id: eventId });
    } catch (error) {
        if (error.status !== 409) throw error;
        const rows = await query('email_delivery_ledger').select('state,result').eq('delivery_key', key).limit(1).execute();
        const previous = rows[0];
        if (previous?.state === 'failed' && !previous.result?.uncertain && !previous.result?.partial) {
            // Only one caller may reclaim a confirmed failure. An in-flight or
            // uncertain send can never be reclaimed automatically.
            const claimed = await query('email_delivery_ledger').eq('delivery_key', key).eq('state', 'failed')
                .patch({ state: 'sending', result: null, updated_at: new Date().toISOString() });
            if (!Array.isArray(claimed) || !claimed.length) {
                return { ok: false, channel: 'pending', uncertain: true, deduplicated: true,
                    error: 'Otro envío está en proceso. No se volvió a enviar.' };
            }
        } else {
            if (previous?.result) return { ...previous.result, deduplicated: true };
            return { ok: false, channel: 'pending', uncertain: true, deduplicated: true,
                error: 'El envío sigue en proceso o pendiente de verificación. No se volvió a enviar.' };
        }
    }
    let result;
    try {
        result = await send();
    } catch (_) {
        result = { ok: false, channel: 'unknown', uncertain: true, error: 'No se pudo confirmar el envío del correo.' };
    }
    const state = result.ok ? 'accepted' : result.uncertain || result.partial ? 'uncertain' : 'failed';
    // No payload, credentials, or message contents are retained in the ledger.
    const safeResult = { ...result };
    delete safeResult.recipients;
    if (safeResult.results) safeResult.results = safeResult.results.map(({ recipients, ...entry }) => entry);
    try {
        await query('email_delivery_ledger').eq('delivery_key', key).patch({ state, result: safeResult, updated_at: new Date().toISOString() });
    } catch (_) {
        // The original claim remains; a retry must never cause a second send.
        console.error('[email-service] Could not persist delivery outcome; original claim retained');
    }
    return result;
}

module.exports = { dispatchOnce, deliveryKey };
