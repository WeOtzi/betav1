/**
 * WE OTZI - Repositorio del dominio Job Board (frontend)
 * ------------------------------------------------------
 * Solicitudes, postulaciones, contraofertas y stats sobre la capa PostgREST
 * unificada. Tablas: job_board_requests / job_board_applications /
 * job_board_attachments (legacy, esquema en la BD viva) +
 * job_board_counter_offers / job_board_request_stats (migracion
 * 20260825130000_job_board_negotiation.sql).
 *
 * Claves: applications.request_id -> requests.id (uuid);
 * counter_offers.application_id -> applications.id (uuid);
 * request_stats.request_id -> requests.id (uuid, 1:1).
 *
 * El accept de una postulacion NO va por aqui: es POST
 * /api/job-board/accept-application (server-side, crea la cotizacion).
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.JobBoard.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[jobboard-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const run = D.run;

    const REQUEST_EMBED = '*, job_board_applications ( id, artist_id, status, message, estimated_price, estimated_sessions, availability_note, portfolio_links, created_at, decided_at ), job_board_attachments ( id, file_url, file_name, sort_order ), job_board_request_stats ( view_count )';

    const Requests = {
        // Solicitudes del cliente con postulaciones/adjuntos/stats embebidos.
        async listForClient(clientUserId) {
            const { data } = await run('jobboard.requests.listForClient', (c) =>
                c.from('job_board_requests').select(REQUEST_EMBED).eq('client_user_id', clientUserId).order('created_at', { ascending: false })
            );
            return data || [];
        },

        // Solicitud completa por id (detalle del cliente). .maybeSingle().
        async getById(requestId) {
            const { data } = await run('jobboard.requests.getById', (c) =>
                c.from('job_board_requests').select(REQUEST_EMBED).eq('id', requestId).maybeSingle()
            );
            return data || null;
        },

        async update(requestId, patch) {
            await run('jobboard.requests.update', (c) =>
                c.from('job_board_requests').update(patch).eq('id', requestId)
            );
        },

        // Cierre manual (recuperable a nivel datos: no borra nada).
        async close(requestId) {
            await run('jobboard.requests.close', (c) =>
                c.from('job_board_requests').update({ status: 'closed', is_public: false }).eq('id', requestId)
            );
        },
    };

    const Applications = {
        // Postulaciones del artista con la solicitud embebida (si la RLS de la
        // solicitud no la deja ver — p.ej. cerrada — el embed llega null y la UI
        // debe degradar con los datos de la application).
        async listForArtist(artistUserId) {
            const { data } = await run('jobboard.applications.listForArtist', (c) =>
                c.from('job_board_applications')
                    .select('*, job_board_requests ( id, request_code, status, tattoo_idea_description, tattoo_style, tattoo_body_part, tattoo_body_side, tattoo_size, tattoo_color_type, client_city, client_country, client_budget_min, client_budget_max, client_budget_currency, client_preferred_date, created_at, resulting_quote_id )')
                    .eq('artist_id', artistUserId)
                    .order('created_at', { ascending: false })
            );
            return data || [];
        },

        // Postulacion completa por id (detalle del artista). .maybeSingle().
        async getById(applicationId) {
            const { data } = await run('jobboard.applications.getById', (c) =>
                c.from('job_board_applications')
                    .select('*, job_board_requests ( *, job_board_attachments ( id, file_url, file_name, sort_order ) )')
                    .eq('id', applicationId)
                    .maybeSingle()
            );
            return data || null;
        },

        // Retiro de la postulacion (estado propio del enum legacy).
        async withdraw(applicationId) {
            await run('jobboard.applications.withdraw', (c) =>
                c.from('job_board_applications').update({ status: 'withdrawn', decided_at: new Date().toISOString() }).eq('id', applicationId)
            );
        },

        // Rechazo por el cliente (el accept va por el endpoint del server).
        async reject(applicationId) {
            await run('jobboard.applications.reject', (c) =>
                c.from('job_board_applications').update({ status: 'rejected', decided_at: new Date().toISOString() }).eq('id', applicationId)
            );
        },
    };

    const CounterOffers = {
        async listByApplication(applicationId) {
            const { data } = await run('jobboard.counterOffers.listByApplication', (c) =>
                c.from('job_board_counter_offers').select('*').eq('application_id', applicationId).order('created_at', { ascending: false })
            );
            return data || [];
        },

        // Crea una contraoferta marcando como reemplazadas las pendientes previas
        // de la misma postulacion (historial conservado).
        async create({ applicationId, authorRole, price = null, currency = 'USD', proposedDate = null, note = null }) {
            await run('jobboard.counterOffers.supersede', (c) =>
                c.from('job_board_counter_offers').update({ status: 'reemplazada' }).eq('application_id', applicationId).eq('status', 'pendiente')
            );
            const { data } = await run('jobboard.counterOffers.create', (c) =>
                c.from('job_board_counter_offers').insert([{
                    application_id: applicationId,
                    author_role: authorRole,
                    price,
                    currency,
                    proposed_date: proposedDate,
                    note,
                }]).select().single()
            );
            return data;
        },

        // Acepta o rechaza una contraoferta pendiente.
        async decide(counterOfferId, status) {
            if (!['aceptada', 'rechazada'].includes(status)) throw new Error('counterOffers.decide: status invalido');
            await run('jobboard.counterOffers.decide', (c) =>
                c.from('job_board_counter_offers').update({ status, decided_at: new Date().toISOString() }).eq('id', counterOfferId)
            );
        },
    };

    const Stats = {
        // Registra una visualizacion (RPC security definer; solo requests abiertas).
        async incrementViews(requestId) {
            try {
                await run('jobboard.stats.incrementViews', (c) =>
                    c.rpc('increment_job_request_views', { p_request_id: requestId })
                );
            } catch (e) {
                console.warn('[jobboard-repo] incrementViews:', e && e.message);
            }
        },
    };

    const JobBoardRealtime = {
        // INSERT de postulaciones de una solicitud (detalle del cliente en vivo).
        subscribeApplicationsForRequest(channelName, requestId, onInsert) {
            const client = D.getClient();
            if (!client) return null;
            return client
                .channel(channelName)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_board_applications', filter: `request_id=eq.${requestId}` }, onInsert)
                .subscribe();
        },
    };

    D.JobBoard = { Requests, Applications, CounterOffers, Stats, Realtime: JobBoardRealtime };
})();
