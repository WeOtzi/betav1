/**
 * Enlaces profundos al Inbox del artista (/artist/inbox).
 *
 * Otras áreas abren una conversación concreta con parámetros de URL:
 *   ?thread=<id>      id de inbox_threads, clave interna (unified:/quote:/support:) o context_id
 *   ?quote=<quote_id> conversación de una cotización (hilo legacy de chat o hilo unificado
 *                     con context_type quotation/quote o context.quote_id)
 *   ?application=<id> postulación de Job Board o Spot (context_id o context.application_id);
 *                     se acompaña de ?opportunity=jobboard|spot para filtrar si no hay hilo
 *   ?trip=<trip_id>   conversación vinculada a un viaje (context_id o context.trip_id)
 *   ?contract=<id>    (o ?contrato=) hilo de un contrato de estudio (context_type
 *                     'studio_contract'); si no hay hilo, abre el filtro Invitaciones
 *   ?filter=<cat>     abre el inbox en una categoría (clients, quotations, invitations, spots,
 *                     job_board, studios, trips, archived, favorites)
 *
 * Los hilos 'studio_contract' (trigger inbox_from_studio_contract) llevan a
 * /artist/invitations?contrato=<id>: contextHref(row) arma ese enlace.
 *
 * Lógica pura: el navegador la expone como window.ArtistInboxDeepLink y los
 * tests la requieren con Node.
 */
(function exposeArtistInboxDeepLink(root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ArtistInboxDeepLink = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createArtistInboxDeepLink() {
    'use strict';

    const FILTERS = ['all', 'clients', 'quotations', 'support', 'invitations', 'spots', 'job_board',
        'studios', 'trips', 'archived', 'favorites'];
    const OPPORTUNITY_FILTERS = { jobboard: 'job_board', job_board: 'job_board', spot: 'spots', spots: 'spots' };
    const QUOTE_CONTEXT_TYPES = ['quotation', 'quote', 'quotations'];
    const STUDIO_CONTRACT_CONTEXT = 'studio_contract';

    function read(params, name) {
        if (!params) return '';
        const value = typeof params.get === 'function' ? params.get(name) : params[name];
        return value == null ? '' : String(value).trim();
    }

    function ctx(row) {
        return (row && row.context) || {};
    }

    function same(a, b) {
        return a != null && b != null && String(a) !== '' && String(a) === String(b);
    }

    const MATCHERS = {
        thread(row, value) {
            return same(row.id, value) || same(row.key, value) || same(row.contextId, value);
        },
        quote(row, value) {
            if (row.source === 'quote' && same(row.id, value)) return true;
            if (QUOTE_CONTEXT_TYPES.includes(String(row.contextType || '')) && same(row.contextId, value)) return true;
            return same(ctx(row).quote_id, value);
        },
        application(row, value) {
            return same(ctx(row).application_id, value)
                || (String(row.contextType || '').includes('application') && same(row.contextId, value));
        },
        trip(row, value) {
            return same(ctx(row).trip_id, value)
                || (String(row.contextType || '') === 'artist_trip' && same(row.contextId, value));
        },
        contract(row, value) {
            return String(row.contextType || '') === STUDIO_CONTRACT_CONTEXT
                && (same(row.contextId, value) || same(ctx(row).contract_id, value));
        },
    };

    // Id del contrato de un hilo 'studio_contract' (context_id o context.contract_id).
    function contractIdOf(row) {
        if (!row || String(row.contextType || row.context_type || '') !== STUDIO_CONTRACT_CONTEXT) return null;
        const value = row.contextId || row.context_id || ctx(row).contract_id;
        return value == null || String(value) === '' ? null : String(value);
    }

    /**
     * Enlace de contexto de un hilo que se resuelve fuera del Inbox: un contrato
     * de estudio se revisa y firma en /artist/invitations?contrato=<id>.
     * Devuelve null para los demás hilos.
     */
    function contextHref(row) {
        const contractId = contractIdOf(row);
        return contractId ? '/artist/invitations?contrato=' + encodeURIComponent(contractId) : null;
    }

    function findRow(rows, kind, value) {
        if (!value) return null;
        return (Array.isArray(rows) ? rows : []).find((row) => row && MATCHERS[kind](row, value)) || null;
    }

    /**
     * Devuelve { key, filter } (cualquiera puede ser null) o null si la URL no
     * pide nada. `key` es la clave de fila de artist-inbox.js.
     */
    function resolveDeepLink(rows, params) {
        const requested = {
            thread: read(params, 'thread'),
            quote: read(params, 'quote'),
            application: read(params, 'application'),
            trip: read(params, 'trip'),
            contract: read(params, 'contract') || read(params, 'contrato'),
        };
        const opportunity = OPPORTUNITY_FILTERS[read(params, 'opportunity').toLowerCase()] || null;
        const explicitFilter = FILTERS.includes(read(params, 'filter')) ? read(params, 'filter') : null;
        const anyRequest = Object.values(requested).some(Boolean) || opportunity || explicitFilter;
        if (!anyRequest) return null;

        for (const kind of ['thread', 'quote', 'application', 'trip', 'contract']) {
            const row = findRow(rows, kind, requested[kind]);
            // Un hilo archivado solo aparece en "Archivados": se abre con ese filtro.
            if (row) return { key: row.key, filter: row.archived ? 'archived' : null };
        }
        // Un contrato sin hilo (todavía) deja el Inbox en Invitaciones.
        const contractFilter = requested.contract ? 'invitations' : null;
        return { key: null, filter: explicitFilter || opportunity || contractFilter || null };
    }

    return { resolveDeepLink, contextHref, contractIdOf, FILTERS, OPPORTUNITY_FILTERS, STUDIO_CONTRACT_CONTEXT };
}));
