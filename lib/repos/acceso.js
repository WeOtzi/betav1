'use strict';

// ── acceso ──
// Repositorio del frente "acceso" (servidor, service-role vía lib/postgrest.js):
//   - perfiles mínimos para decidir la bienvenida (artists_db / clients_db);
//   - aceptación de Términos del cliente (clients_db.terms_accepted_at /
//     terms_version, migración 20261115100000). El trigger
//     guard_client_terms_acceptance solo deja escribirlas al service-role.

const { pgrest } = require('../postgrest');
const { isMissingTermsColumnError } = require('../terms-acceptance');

const AccesoRepo = {
    getArtistProfile(userId) {
        return pgrest('artists_db')
            .select('user_id,registration_status,terms_accepted_at,terms_version')
            .eq('user_id', userId).limit(1).single().execute();
    },

    getClientProfile(userId) {
        return pgrest('clients_db')
            .select('user_id')
            .eq('user_id', userId).limit(1).single().execute();
    },

    // Sella la aceptación solo si todavía no hay una (no pisa la fecha original).
    // Devuelve { stored, already, missingColumns }.
    async stampClientTerms(userId, { version, acceptedAt }) {
        try {
            const rows = await pgrest('clients_db')
                .eq('user_id', userId)
                .is('terms_accepted_at', null)
                .patch({ terms_accepted_at: acceptedAt, terms_version: version });
            return { stored: Array.isArray(rows) && rows.length > 0, already: !(Array.isArray(rows) && rows.length), missingColumns: false };
        } catch (err) {
            // Sin la migración aplicada las columnas no existen: no rompe el alta.
            if (isMissingTermsColumnError(err)) return { stored: false, already: false, missingColumns: true };
            throw err;
        }
    }
};

module.exports = { AccesoRepo };
