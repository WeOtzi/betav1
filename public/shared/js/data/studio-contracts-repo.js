/**
 * WE OTZI - Repositorio de Contratos de estudio (frontend)
 * --------------------------------------------------------
 * Metodos con nombre sobre la capa PostgREST unificada (postgrest-client.js)
 * para los contratos registrados estudio <-> artista
 * (docs/plans/2026-10-30-estudios-plataforma.md, M2).
 *
 * Tablas: studio_contracts (solo lectura: RLS sin INSERT/UPDATE/DELETE), con
 * embeds de artists_db, studios, studio_spots y studio_locations.
 * RPCs: save_studio_contract_draft, prepare_contract_from_application,
 * prepare_contract_for_membership, get_current_contract_for_membership,
 * issue_studio_contract, sign_studio_contract, decline_studio_contract,
 * cancel_studio_contract, terminate_studio_contract, expire_studio_contracts.
 *
 * Contrato: igual que studios-repo.js. Son WRAPPERS FINOS que devuelven el
 * builder o la RPC sin resolver (`{ data, error }`) y nunca lanzan. Los
 * listados que corren al cargar una pantalla tragan la "migracion pendiente"
 * (42P01, PGRST205, 42883, ...) y devuelven `{ data: [] | null, error: null,
 * unavailable: true }` para que la UI quede vacia sin romperse.
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.StudioContracts.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.from !== 'function') {
        console.error('[studio-contracts-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const from = D.from;
    const client = () => D.getClient();

    // Codigos de "falta aplicar una migracion" (Reglas transversales §5).
    const MISSING_SCHEMA_CODES = ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'];
    function isMissingSchema(error) {
        if (!error) return false;
        return MISSING_SCHEMA_CODES.indexOf(String(error.code || (error.cause && error.cause.code) || '')) !== -1;
    }

    // Devuelve el builder sin resolver; si armarlo lanza (sin cliente), una
    // promesa ya resuelta con { data: null, error }.
    function guard(build) {
        try {
            return build();
        } catch (error) {
            return Promise.resolve({ data: null, error });
        }
    }
    function rpc(name, args) {
        return guard(() => client().rpc(name, args));
    }
    async function settle(build) {
        try {
            const result = await build();
            return result || { data: null, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }
    async function soft(build, empty) {
        const result = await settle(build);
        if (result.error && isMissingSchema(result.error)) return { data: empty, error: null, unavailable: true };
        return result;
    }
    async function allRows(buildQuery) {
        const rows = [];
        for (let offset = 0; ; offset += 500) {
            const result = await buildQuery().range(offset, offset + 499);
            if (result.error) return result;
            rows.push(...(result.data || []));
            if ((result.data || []).length < 500) return { data: rows, error: null };
        }
    }
    // Filtro de status: string -> eq, array -> in, vacio -> sin filtro.
    function byStatus(query, status) {
        if (Array.isArray(status)) return status.length ? query.in('status', status) : query;
        return status ? query.eq('status', status) : query;
    }

    const ARTIST_EMBED = 'artists_db ( user_id, name, username, profile_picture )';
    const STUDIO_EMBED = 'studios ( id, name, slug, logo_image, city, country )';
    const SPOT_EMBED = 'studio_spots ( id, title, kind )';
    const LOCATION_EMBED = 'studio_locations ( id, label, city, country )';

    const StudioContracts = {
        // --- listado ---

        // Contratos del estudio (dueno/soporte ven tambien los borradores), con
        // el artista y el titulo del spot embebidos. status: string o array.
        listForStudio(studioId, { status = null } = {}) {
            return soft(() => allRows(() => byStatus(from('studio_contracts')
                .select(`*, ${ARTIST_EMBED}, ${SPOT_EMBED}, ${LOCATION_EMBED}`)
                .eq('studio_id', studioId), status)
                .order('created_at', { ascending: false })
                .order('id')), []);
        },

        // Contratos del artista (la RLS oculta los borradores), con el estudio
        // embebido. status: string o array.
        listForArtist(artistUserId, { status = null } = {}) {
            return soft(() => allRows(() => byStatus(from('studio_contracts')
                .select(`*, ${STUDIO_EMBED}, ${SPOT_EMBED}, ${LOCATION_EMBED}`)
                .eq('artist_user_id', artistUserId), status)
                .order('created_at', { ascending: false })
                .order('id')), []);
        },

        // Contrato completo por id con partes, spot y sede. .maybeSingle().
        get(id) {
            return guard(() => from('studio_contracts')
                .select(`*, ${ARTIST_EMBED}, ${STUDIO_EMBED}, ${SPOT_EMBED}, ${LOCATION_EMBED}`)
                .eq('id', id)
                .maybeSingle());
        },

        // Contrato sent o signed de mayor version de la membresia (jsonb o
        // null). Corre al cargar roster/invitaciones: sin la RPC -> null +
        // `unavailable`.
        getCurrentForMembership(membershipId) {
            return soft(() => rpc('get_current_contract_for_membership', { p_membership_id: membershipId }), null);
        },

        // --- borrador ---

        // Crea o actualiza (obj.id) un borrador. La RPC aplica la lista blanca
        // de claves editables. Devuelve el uuid del contrato.
        saveDraft(obj) {
            return rpc('save_studio_contract_draft', { p_contract: obj || {} });
        },

        // Borrador desde una postulacion (o el draft/sent que ya exista). uuid.
        prepareFromApplication(applicationId) {
            return rpc('prepare_contract_from_application', { p_application_id: applicationId });
        },

        // Borrador para una membresia abierta (o el draft/sent que ya exista). uuid.
        prepareForMembership(membershipId) {
            return rpc('prepare_contract_for_membership', { p_membership_id: membershipId });
        },

        // --- ciclo de vida ---

        // Solo el dueno: draft -> sent con la firma del estudio. expiresAt
        // null => la RPC usa 14 dias.
        issue(id, signerName, expiresAt) {
            return rpc('issue_studio_contract', {
                p_contract_id: id,
                p_signer_name: signerName,
                p_expires_at: expiresAt || null,
            });
        },

        // El artista firma: nombre completo + aceptacion explicita de los
        // terminos. Devuelve { contract_id, membership_id }.
        sign(id, signerName, acceptTerms) {
            return rpc('sign_studio_contract', {
                p_contract_id: id,
                p_signer_name: signerName,
                p_accept_terms: acceptTerms === true,
            });
        },

        // El artista rechaza un contrato enviado.
        decline(id, reason) {
            return rpc('decline_studio_contract', { p_contract_id: id, p_reason: reason || null });
        },

        // El estudio (o soporte) cancela un draft o sent.
        cancel(id, reason) {
            return rpc('cancel_studio_contract', { p_contract_id: id, p_reason: reason || null });
        },

        // Cualquiera de las partes rescinde un signed. endMembership por
        // defecto true: la membresia pasa a ended.
        terminate(id, reason, endMembership) {
            return rpc('terminate_studio_contract', {
                p_contract_id: id,
                p_reason: reason,
                p_end_membership: endMembership !== false,
            });
        },

        // Vence los sent pasados de fecha y cierra los signed fuera de
        // vigencia del caller. Devuelve la cantidad tocada; sin la RPC, 0 +
        // `unavailable` (se llama al listar y al cargar el roster).
        expireOverdue(studioId) {
            return soft(() => rpc('expire_studio_contracts', { p_studio_id: studioId || null }), 0);
        },
    };

    D.StudioContracts = StudioContracts;
})();
