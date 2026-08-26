/**
 * WE OTZI - Repositorio del dominio Cuenta (frontend)
 * ---------------------------------------------------
 * Centro de la cuenta (/artist/account y /client/profile) sobre la capa
 * PostgREST unificada. Tablas: user_preferences, artist_billing_profiles
 * (migracion 20260825120000_account_center.sql) y
 * artist_verification_documents (20260825140000, PENDIENTE de aplicar:
 * VerificationDocs degrada con isAvailable()).
 *
 * user_preferences guarda JSONB por seccion:
 *   notification_prefs: { [evento]: { email: bool, push: bool } }
 *   privacy:            { show_city, show_socials, allow_search_indexing, ... }
 *   app_settings:       { timezone, date_format, availability: {weekly, ...}, ... }
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.{Prefs,
 * Billing, VerificationDocs}.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[account-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const run = D.run;

    // ===================== user_preferences =====================
    const Prefs = {
        // Fila completa del usuario (o null si nunca guardo nada).
        async get(userId) {
            const { data } = await run('prefs.get', (c) =>
                c.from('user_preferences').select('*').eq('user_id', userId).maybeSingle()
            );
            return data || null;
        },

        // Upsert de una seccion completa ('notification_prefs' | 'privacy' |
        // 'app_settings') con merge superficial sobre lo existente.
        async saveSection(userId, section, value) {
            const allowed = ['notification_prefs', 'privacy', 'app_settings'];
            if (!allowed.includes(section)) throw new Error(`prefs.saveSection: seccion invalida ${section}`);
            const current = await this.get(userId);
            const merged = Object.assign({}, (current && current[section]) || {}, value || {});
            const row = { user_id: userId, [section]: merged };
            const { data } = await run('prefs.saveSection', (c) =>
                c.from('user_preferences').upsert([row], { onConflict: 'user_id' }).select().maybeSingle()
            );
            return data || null;
        },
    };

    // ===================== artist_billing_profiles =====================
    const Billing = {
        async get(artistUserId) {
            const { data } = await run('billing.get', (c) =>
                c.from('artist_billing_profiles').select('*').eq('artist_user_id', artistUserId).maybeSingle()
            );
            return data || null;
        },

        async upsert(artistUserId, { legalName, taxId }) {
            const row = { artist_user_id: artistUserId, legal_name: legalName, tax_id: taxId };
            const { data } = await run('billing.upsert', (c) =>
                c.from('artist_billing_profiles').upsert([row], { onConflict: 'artist_user_id' }).select().maybeSingle()
            );
            return data || null;
        },
    };

    // ===================== artist_verification_documents =====================
    // La migracion que crea esta tabla puede no estar aplicada todavia: la UI
    // debe consultar isAvailable() y deshabilitar la carga si devuelve false.
    const VerificationDocs = {
        _available: null,

        async isAvailable() {
            if (this._available !== null) return this._available;
            try {
                await run('verifdocs.probe', (c) =>
                    c.from('artist_verification_documents').select('id', { count: 'exact', head: true })
                );
                this._available = true;
            } catch (e) {
                console.warn('[account-repo] artist_verification_documents no disponible (migracion pendiente):', e && e.message);
                this._available = false;
            }
            return this._available;
        },

        async list(artistUserId) {
            const { data } = await run('verifdocs.list', (c) =>
                c.from('artist_verification_documents').select('*').eq('artist_user_id', artistUserId).order('uploaded_at', { ascending: false })
            );
            return data || [];
        },

        // El upload al bucket artist-verification lo hace la pagina; aqui el registro.
        async add({ artistUserId, docType, fileName, storagePath }) {
            const { data } = await run('verifdocs.add', (c) =>
                c.from('artist_verification_documents').insert([{ artist_user_id: artistUserId, doc_type: docType, file_name: fileName, storage_path: storagePath }]).select().single()
            );
            return data;
        },

        // Solo documentos pendientes (lo exige la policy de delete).
        async delete(documentId) {
            await run('verifdocs.delete', (c) =>
                c.from('artist_verification_documents').delete().eq('id', documentId)
            );
        },
    };

    D.Prefs = Prefs;
    D.Billing = Billing;
    D.VerificationDocs = VerificationDocs;
})();
