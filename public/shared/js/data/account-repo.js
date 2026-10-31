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
 * We Ötzi Wallet (Figma final oct 2026, migracion NO aplicada
 * 20261028150000_artist_wallet.sql): artist_payout_destinations,
 * artist_wallet_movements (+ RPC request_artist_wallet_withdrawal) y
 * wallet_card_waitlist. Cada repo expone isAvailable() para degradar sin
 * romper la pagina si la tabla todavia no existe.
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.{Prefs,
 * Billing, VerificationDocs, PaymentMethods, FinancialLedger,
 * AccountSessions, AccountIntegrations, AccountDeletionRequests,
 * PayoutDestinations, WalletMovements, CardWaitlist, AvailabilityLocations,
 * AccountProfile}.
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

    // Dígitos de un valor que no lleva letras: cualquier otro carácter
    // (espacio, guion, punto, guion bajo, barra…) cuenta como separador, así
    // "4111.1111.1111.1111" no se cuela como identificador. null si hay letras.
    function separatedDigits(value) {
        let text = String(value || '');
        if (typeof text.normalize === 'function') text = text.normalize('NFKC');
        text = text.trim();
        if (!text || /[A-Za-z]/.test(text)) return null;
        return text.replace(/\D/g, '');
    }

    function looksLikeRawPan(value) {
        const digits = separatedDigits(value);
        return digits !== null && /^\d{12,19}$/.test(digits);
    }

    // PAN con dígito verificador de Luhn válido. Para destinos de retiro: una
    // cuenta bancaria de 12-19 dígitos que no pasa Luhn sigue siendo válida.
    function looksLikeCardNumber(value) {
        if (!looksLikeRawPan(value)) return false;
        const digits = separatedDigits(value);
        let sum = 0;
        for (let i = 0; i < digits.length; i++) {
            let d = Number(digits.charAt(digits.length - 1 - i));
            if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
            sum += d;
        }
        return sum % 10 === 0;
    }

    // ===================== user_preferences =====================
    // Las escrituras de un mismo usuario se encolan: cada saveSection hace
    // GET + merge + UPSERT, y dos cambios seguidos (p. ej. zona horaria y
    // densidad en Configuración) se pisaban si corrían en paralelo.
    const prefsQueues = new Map();
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
        saveSection(userId, section, value) {
            const allowed = ['notification_prefs', 'privacy', 'app_settings'];
            if (!allowed.includes(section)) return Promise.reject(new Error(`prefs.saveSection: seccion invalida ${section}`));
            const write = async () => {
                const current = await this.get(userId);
                const merged = Object.assign({}, (current && current[section]) || {}, value || {});
                const row = { user_id: userId, [section]: merged };
                const { data } = await run('prefs.saveSection', (c) =>
                    c.from('user_preferences').upsert([row], { onConflict: 'user_id' }).select().maybeSingle()
                );
                return data || null;
            };
            const previous = prefsQueues.get(userId) || Promise.resolve();
            const next = previous.catch(() => null).then(write);
            const tail = next.catch(() => null);
            prefsQueues.set(userId, tail);
            tail.then(() => { if (prefsQueues.get(userId) === tail) prefsQueues.delete(userId); });
            return next;
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

    // ===================== artist_payout_destinations (Wallet) =====================
    // Destinos de retiro. La verificacion la hace soporte/proveedor: un trigger
    // de la migracion fuerza verification_status = 'pending' en altas y cambios.
    const PAYOUT_METHODS = ['lemon', 'bank_usd', 'bank_international'];
    const PayoutDestinations = {
        isAvailable: availabilityProbe('artist_payout_destinations', 'payoutdest'),

        async list(artistUserId) {
            const { data } = await run('payoutdest.list', (c) =>
                c.from('artist_payout_destinations').select('*')
                    .eq('artist_user_id', artistUserId).eq('active', true)
                    .order('is_default', { ascending: false }).order('created_at', { ascending: true })
            );
            return data || [];
        },

        async save(artistUserId, destination) {
            const method = String(destination.method || '');
            if (!PAYOUT_METHODS.includes(method)) throw new Error('payoutdest.save: metodo no disponible');
            const identifier = String(destination.accountIdentifier || '').trim();
            // CBU (22 digitos), IBAN o alias: nunca datos de tarjeta (el modal lo aclara).
            if (looksLikeCardNumber(identifier)) throw new Error('payoutdest.save: el identificador parece un numero de tarjeta');
            if (identifier.length < 4 || identifier.length > 64) throw new Error('payoutdest.save: identificador invalido');
            if (hasForbiddenMetadata(destination.metadata || {}, ['pan', 'card_number', 'cvv', 'cvc', 'security_code'])) {
                throw new Error('payoutdest.save: metadata de tarjeta no permitida');
            }
            const row = {
                artist_user_id: artistUserId,
                method,
                label: String(destination.label || '').trim().slice(0, 80),
                holder_name: String(destination.holderName || '').trim().slice(0, 120),
                currency: String(destination.currency || 'USD').trim().toUpperCase(),
                account_identifier: identifier,
                rail: destination.rail || null,
                country_code: destination.countryCode || null,
                metadata_json: { entered_via: 'account_center' },
                active: true
            };
            const query = destination.id
                ? (c) => c.from('artist_payout_destinations').update(row).eq('id', destination.id).eq('artist_user_id', artistUserId).select().single()
                : (c) => c.from('artist_payout_destinations').insert([Object.assign({ is_default: !!destination.isDefault }, row)]).select().single();
            const { data } = await run('payoutdest.save', query);
            return data;
        },

        async setDefault(artistUserId, destinationId) {
            await run('payoutdest.setDefault', (c) =>
                c.rpc('set_artist_default_payout_destination', { p_destination_id: destinationId })
            );
            return this.list(artistUserId);
        },

        async remove(artistUserId, destinationId) {
            const { data } = await run('payoutdest.remove', (c) =>
                c.from('artist_payout_destinations').update({ active: false, is_default: false })
                    .eq('artist_user_id', artistUserId).eq('id', destinationId).select().single()
            );
            return data;
        }
    };

    // ===================== artist_wallet_movements (Wallet) =====================
    const WalletMovements = {
        isAvailable: availabilityProbe('artist_wallet_movements', 'walletmoves'),

        async list(artistUserId, limit = 300) {
            const { data } = await run('walletmoves.list', (c) =>
                c.from('artist_wallet_movements').select('*')
                    .eq('artist_user_id', artistUserId)
                    .order('occurred_at', { ascending: false }).limit(limit)
            );
            return data || [];
        },

        // El saldo se valida en el servidor (RPC security definer con lock).
        async requestWithdrawal({ destinationId, amount, currency }) {
            const value = Math.round(Number(amount) * 100) / 100;
            if (!destinationId || !(value > 0)) throw new Error('walletmoves.requestWithdrawal: datos invalidos');
            const { data } = await run('walletmoves.requestWithdrawal', (c) =>
                c.rpc('request_artist_wallet_withdrawal', {
                    p_destination_id: destinationId,
                    p_amount: value,
                    p_currency: String(currency || 'USD').toUpperCase()
                })
            );
            return data;
        }
    };

    // ===================== wallet_card_waitlist (We Ötzi Card) =====================
    const CardWaitlist = {
        isAvailable: availabilityProbe('wallet_card_waitlist', 'cardwaitlist'),

        async get(userId) {
            const { data } = await run('cardwaitlist.get', (c) =>
                c.from('wallet_card_waitlist').select('*').eq('user_id', userId).maybeSingle()
            );
            return data || null;
        },

        async join(userId, email) {
            const clean = String(email || '').trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('cardwaitlist.join: email invalido');
            const { data } = await run('cardwaitlist.join', (c) =>
                c.from('wallet_card_waitlist')
                    .upsert([{ user_id: userId, email: clean, source: 'artist_wallet' }], { onConflict: 'user_id' })
                    .select().maybeSingle()
            );
            return data || { user_id: userId, email: clean };
        }
    };

    // ===================== artist_tattoo_locations (Disponibilidad) =====================
    // Ubicaciones del artista para "Disponibilidad por ubicacion". Estudio base y
    // privados = period_type 'current'; destinos Travel = 'upcoming' con fechas.
    const AvailabilityLocations = {
        async list(artistUserId) {
            const { data } = await run('availlocations.list', (c) =>
                c.from('artist_tattoo_locations').select('*')
                    .eq('artist_user_id', artistUserId)
                    .order('sort_order', { ascending: true })
            );
            return data || [];
        },

        async setAgendaStatus(artistUserId, locationId, status) {
            // 'waitlist' requiere la migracion 20261028160000_artist_residency_country_waitlist.sql.
            if (!['open', 'closed', 'waitlist'].includes(status)) throw new Error('availlocations.setAgendaStatus: estado invalido');
            const { data } = await run('availlocations.setAgendaStatus', (c) =>
                c.from('artist_tattoo_locations').update({ agenda_status: status })
                    .eq('artist_user_id', artistUserId).eq('id', locationId).select().maybeSingle()
            );
            return data || null;
        },

        // country y agenda_status 'waitlist' llegan con la migracion NO aplicada
        // 20261028160000_artist_residency_country_waitlist.sql: si el esquema
        // todavia no los tiene, se reintenta sin ellos y se marca `degraded`.
        async addUpcoming(artistUserId, { studioName, city, country, agendaStatus, startDate, endDate }, existing = []) {
            const used = existing.filter((l) => l.period_type === 'upcoming').map((l) => Number(l.sort_order) || 0);
            const sortOrder = used.length ? Math.max(...used) + 1 : 0;
            const base = {
                artist_user_id: artistUserId,
                period_type: 'upcoming',
                studio_name: String(studioName || '').trim(),
                city: String(city || '').trim() || null,
                agenda_status: 'open',
                start_date: startDate,
                end_date: endDate,
                sort_order: sortOrder
            };
            const full = Object.assign({}, base, { agenda_status: agendaStatus === 'waitlist' ? 'waitlist' : 'open' });
            if (String(country || '').trim()) full.country = String(country).trim();
            const insert = (row) => run('availlocations.addUpcoming', (c) =>
                c.from('artist_tattoo_locations').insert([row]).select().single()
            );
            try {
                const { data } = await insert(full);
                return data;
            } catch (error) {
                const extended = full.country !== undefined || full.agenda_status !== 'open';
                const schemaGap = /country|agenda_status|check|column/i.test(String(error && (error.message || error.code)));
                if (!extended || !schemaGap) throw error;
                const { data } = await insert(base);
                return Object.assign({}, data, { degraded: true });
            }
        }
    };

    // ===================== artists_db · datos de oficio del perfil =====================
    // Campos que antes se editaban en /artist/profile/details (estilos,
    // experiencia, tarifa, WhatsApp, newsletter) y ahora viven en Mi perfil,
    // más la modalidad de trabajo y el estudio (Disponibilidad · Modalidad).
    const ACCOUNT_EXTRAS_SELECT = 'styles_array, estilo, years_experience, session_price, ' +
        'session_price_amount, session_price_currency, whatsapp_number, subscribed_newsletter, ' +
        'work_type, estudios, studio_id';
    const AccountProfile = {
        async getExtras(artistUserId) {
            const { data } = await run('accountprofile.getExtras', (c) =>
                c.from('artists_db').select(ACCOUNT_EXTRAS_SELECT).eq('user_id', artistUserId).maybeSingle()
            );
            return data || null;
        }
    };

    D.PayoutDestinations = PayoutDestinations;
    D.WalletMovements = WalletMovements;
    D.CardWaitlist = CardWaitlist;
    D.AvailabilityLocations = AvailabilityLocations;
    D.AccountProfile = AccountProfile;

    D.Prefs = Prefs;
    D.Billing = Billing;
    D.PaymentMethods = PaymentMethods;
    D.FinancialLedger = FinancialLedger;
    D.AccountSessions = AccountSessions;
    D.AccountIntegrations = AccountIntegrations;
    D.AccountDeletionRequests = AccountDeletionRequests;
    D.VerificationDocs = VerificationDocs;
})();
