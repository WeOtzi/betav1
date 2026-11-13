'use strict';

// ── privacidad ──
// Repositorio del consentimiento de cookies (servidor, service-role vía
// lib/postgrest.js). Fuente: migración 20261113105000_privacidad_cookie_consent.sql
//   - rpc record_cookie_consent(p_user_id, p_consent): guarda en
//     user_preferences.privacy.cookie_consent y agrega una fila a
//     cookie_consent_log (historial para demostrar el consentimiento).
// Si la migración todavía no está aplicada (la RPC no existe), cae a un
// merge leer-y-escribir sobre user_preferences.privacy (sin historial).

const { pgrest } = require('../postgrest');

const PrivacyRepo = {
    async getCookieConsent(userId) {
        const row = await pgrest('user_preferences')
            .select('privacy')
            .eq('user_id', userId)
            .limit(1).single().execute();
        const consent = row && row.privacy && row.privacy.cookie_consent;
        return consent && typeof consent === 'object' ? consent : null;
    },

    async saveCookieConsent(userId, consent) {
        try {
            await pgrest.raw('rpc/record_cookie_consent', {
                method: 'POST',
                body: { p_user_id: userId, p_consent: consent },
                prefer: 'return=minimal'
            });
            return { stored: true, log: true };
        } catch (err) {
            // 404 / PGRST202: la función no existe todavía en esta base.
            if (!(err && (err.status === 404 || /PGRST202|record_cookie_consent/.test(String(err.message))))) throw err;
        }
        const row = await pgrest('user_preferences')
            .select('privacy')
            .eq('user_id', userId)
            .limit(1).single().execute();
        const privacy = Object.assign({}, (row && row.privacy) || {}, { cookie_consent: consent });
        await pgrest('user_preferences').upsert(
            [{ user_id: userId, privacy }],
            { onConflict: 'user_id', returning: false }
        );
        return { stored: true, log: false };
    }
};

module.exports = { PrivacyRepo };
