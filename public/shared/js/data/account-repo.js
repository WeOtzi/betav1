/**
 * WE OTZI - Repositorio del dominio Cuenta (frontend)
 * ---------------------------------------------------
 * Centro de la cuenta (/artist/account y /client/profile) sobre la capa
 * PostgREST unificada. Tablas: user_preferences, artist_billing_profiles
 * (migracion 20260825120000_account_center.sql),
 * artist_verification_documents (20260825140000) y los modelos aditivos de
 * 20260829133000_account_center_runtime.sql.
 *
 * user_preferences guarda JSONB por seccion:
 *   notification_prefs: { [evento]: { email: bool, push: bool, sms: bool } }
 *   privacy:            { show_city, show_socials, allow_search_indexing, ... }
 *   app_settings:       { timezone, date_format, availability: {weekly, ...}, ... }
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.{Prefs,
 * Billing, VerificationDocs, PaymentMethods, FinancialLedger,
 * AccountSessions, AccountIntegrations, AccountDeletionRequests}.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[account-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const run = D.run;

    function availabilityProbe(table, label) {
        let available = null;
        return async function isAvailable() {
            if (available !== null) return available;
            try {
                await run(`${label}.probe`, (c) => c.from(table).select('id', { count: 'exact', head: true }));
                available = true;
            } catch (error) {
                console.warn(`[account-repo] ${table} no disponible:`, error && error.message);
                available = false;
            }
            return available;
        };
    }

    function hasForbiddenMetadata(value, forbidden) {
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value)) return value.some((item) => hasForbiddenMetadata(item, forbidden));
        return Object.entries(value).some(([key, child]) =>
            forbidden.includes(String(key).toLowerCase()) || hasForbiddenMetadata(child, forbidden)
        );
    }

    function looksLikeRawPan(value) {
        const text = String(value || '').trim();
        if (!/^[0-9\s-]+$/.test(text)) return false;
        const digits = text.replace(/[\s-]/g, '');
        return /^\d{12,19}$/.test(digits);
    }

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

    // ===================== artist_payment_methods =====================
    // providerReference SIEMPRE es un identificador tokenizado emitido por el
    // proveedor. Este repositorio no acepta ni transforma PAN/CVV.
    const PaymentMethods = {
        isAvailable: availabilityProbe('artist_payment_methods', 'paymentmethods'),

        async list(artistUserId) {
            const { data } = await run('paymentmethods.list', (c) =>
                c.from('artist_payment_methods').select('*')
                    .eq('artist_user_id', artistUserId).eq('active', true)
                    .order('is_default', { ascending: false }).order('created_at', { ascending: true })
            );
            return data || [];
        },

        async save(artistUserId, method) {
            const forbidden = ['pan', 'card_number', 'cvv', 'cvc', 'security_code'];
            const metadata = method.metadata || {};
            if (hasForbiddenMetadata(metadata, forbidden)) {
                throw new Error('paymentmethods.save: metadata de tarjeta no permitida');
            }
            if (!method.providerReference || String(method.providerReference).length < 4) {
                throw new Error('paymentmethods.save: falta referencia tokenizada del proveedor');
            }
            if (looksLikeRawPan(method.providerReference)) {
                throw new Error('paymentmethods.save: la referencia parece un numero de tarjeta sin tokenizar');
            }
            const row = {
                artist_user_id: artistUserId,
                provider: method.provider,
                method_type: method.methodType,
                provider_reference: String(method.providerReference).trim(),
                display_name: String(method.displayName || '').trim(),
                brand: method.brand || null,
                last_four: method.lastFour || null,
                account_hint: method.accountHint || null,
                metadata_json: metadata,
                is_default: !!method.isDefault,
                active: true
            };
            const query = method.id
                ? (c) => c.from('artist_payment_methods').update(row).eq('id', method.id).eq('artist_user_id', artistUserId).select().single()
                : (c) => c.from('artist_payment_methods').insert([row]).select().single();
            const { data } = await run('paymentmethods.save', query);
            return data;
        },

        async setDefault(artistUserId, methodId) {
            await run('paymentmethods.setDefault', (c) =>
                c.rpc('set_artist_default_payment_method', { p_method_id: methodId })
            );
            return this.list(artistUserId);
        },

        async remove(artistUserId, methodId) {
            const { data } = await run('paymentmethods.remove', (c) =>
                c.from('artist_payment_methods').update({ active: false, is_default: false })
                    .eq('artist_user_id', artistUserId).eq('id', methodId).select().single()
            );
            return data;
        }
    };

    // ===================== artist_financial_entries =====================
    const FinancialLedger = {
        isAvailable: availabilityProbe('artist_financial_entries', 'ledger'),

        async list(artistUserId, limit = 50) {
            const { data } = await run('ledger.list', (c) =>
                c.from('artist_financial_entries').select('*')
                    .eq('artist_user_id', artistUserId)
                    .order('occurred_at', { ascending: false }).limit(limit)
            );
            return data || [];
        }
    };

    // ===================== artist_account_sessions =====================
    const AccountSessions = {
        isAvailable: availabilityProbe('artist_account_sessions', 'accountsessions'),

        async list(artistUserId) {
            const { data } = await run('accountsessions.list', (c) =>
                c.from('artist_account_sessions').select('*')
                    .eq('artist_user_id', artistUserId).is('revoked_at', null)
                    .order('last_seen_at', { ascending: false })
            );
            return data || [];
        },

        async touch(artistUserId, sessionId, device) {
            const row = {
                artist_user_id: artistUserId,
                auth_session_id: sessionId,
                device_name: device.deviceName,
                browser: device.browser || null,
                operating_system: device.operatingSystem || null,
                user_agent_hash: device.userAgentHash || null,
                last_seen_at: new Date().toISOString(),
                revoked_at: null,
                revoke_reason: null
            };
            const { data } = await run('accountsessions.touch', (c) =>
                c.from('artist_account_sessions').upsert([row], { onConflict: 'artist_user_id,auth_session_id' }).select().single()
            );
            return data;
        },

        async revoke(artistUserId, sessionId, reason = 'Revocada por el artista') {
            const { data } = await run('accountsessions.revoke', (c) =>
                c.from('artist_account_sessions').update({
                    revoked_at: new Date().toISOString(), revoke_reason: reason
                }).eq('artist_user_id', artistUserId).eq('auth_session_id', sessionId).select().maybeSingle()
            );
            return data || null;
        },

        async revokeOthers(artistUserId, currentSessionId) {
            const { data } = await run('accountsessions.revokeOthers', (c) =>
                c.from('artist_account_sessions').update({
                    revoked_at: new Date().toISOString(), revoke_reason: 'Cierre de todas las demás sesiones'
                }).eq('artist_user_id', artistUserId).neq('auth_session_id', currentSessionId).is('revoked_at', null).select()
            );
            return data || [];
        }
    };

    // ===================== artist_integration_connections =====================
    const AccountIntegrations = {
        isAvailable: availabilityProbe('artist_integration_connections', 'accountintegrations'),

        async list(artistUserId) {
            const { data } = await run('accountintegrations.list', (c) =>
                c.from('artist_integration_connections').select('*').eq('artist_user_id', artistUserId)
            );
            return data || [];
        },

        async save(artistUserId, provider, patch) {
            const metadata = patch.metadata || {};
            const forbidden = ['access_token', 'refresh_token', 'id_token', 'api_key', 'client_secret', 'secret', 'password', 'authorization', 'cookie'];
            if (hasForbiddenMetadata(metadata, forbidden)) {
                throw new Error('accountintegrations.save: secretos no permitidos');
            }
            const row = {
                artist_user_id: artistUserId,
                provider,
                status: patch.status || 'disconnected',
                account_label: patch.accountLabel || null,
                provider_reference: patch.providerReference || null,
                scopes: patch.scopes || [],
                metadata_json: metadata,
                connected_at: patch.status === 'connected' ? (patch.connectedAt || new Date().toISOString()) : null
            };
            const { data } = await run('accountintegrations.save', (c) =>
                c.from('artist_integration_connections').upsert([row], { onConflict: 'artist_user_id,provider' }).select().single()
            );
            return data;
        }
    };

    // ===================== artist_account_deletion_requests =====================
    const AccountDeletionRequests = {
        isAvailable: availabilityProbe('artist_account_deletion_requests', 'deletionrequests'),

        async list(artistUserId) {
            const { data } = await run('deletionrequests.list', (c) =>
                c.from('artist_account_deletion_requests').select('*')
                    .eq('artist_user_id', artistUserId).order('requested_at', { ascending: false })
            );
            return data || [];
        },

        async request(artistUserId, reason) {
            const { data } = await run('deletionrequests.request', (c) =>
                c.from('artist_account_deletion_requests').insert([{
                    artist_user_id: artistUserId,
                    reason: String(reason || '').trim() || null,
                    status: 'requested'
                }]).select().single()
            );
            return data;
        }
    };

    // ===================== artist_verification_documents =====================
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
        async replace({ artistUserId, docType, fileName, storagePath }) {
            const previous = (await this.list(artistUserId)).find((d) => d.doc_type === docType) || null;
            const row = {
                artist_user_id: artistUserId,
                doc_type: docType,
                file_name: fileName,
                storage_path: storagePath,
                status: 'pendiente',
                reviewed_at: null,
                reviewer_notes: null,
                uploaded_at: new Date().toISOString()
            };
            const { data } = await run('verifdocs.add', (c) =>
                c.from('artist_verification_documents').upsert([row], { onConflict: 'artist_user_id,doc_type' }).select().single()
            );
            return { document: data, previous };
        },

        async add(args) { return (await this.replace(args)).document; },

        // Solo documentos pendientes (lo exige la policy de delete).
        async delete(documentId) {
            await run('verifdocs.delete', (c) =>
                c.from('artist_verification_documents').delete().eq('id', documentId)
            );
        },
    };

    D.Prefs = Prefs;
    D.Billing = Billing;
    D.PaymentMethods = PaymentMethods;
    D.FinancialLedger = FinancialLedger;
    D.AccountSessions = AccountSessions;
    D.AccountIntegrations = AccountIntegrations;
    D.AccountDeletionRequests = AccountDeletionRequests;
    D.VerificationDocs = VerificationDocs;
})();
