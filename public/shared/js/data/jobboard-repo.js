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
                    .select('*, job_board_requests ( id, request_code, client_user_id, status, display_title, client_display_name, client_avatar_url, tattoo_idea_description, tattoo_style, tattoo_body_part, tattoo_body_side, tattoo_size, tattoo_color_type, client_city, client_country, client_budget_min, client_budget_max, client_budget_currency, client_preferred_date, created_at, resulting_quote_id, job_board_attachments ( id, file_url, file_name, sort_order ) )')
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

    const Featured = {
        // Oportunidad patrocinada persistente. Devuelve un contrato de UI
        // normalizado y conserva la fila original para callers avanzados.
        async getActive() {
            const { data } = await run('jobboard.featured.getActive', (c) =>
                c.from('job_board_requests')
                    .select('*, job_board_attachments ( id, file_url, file_name, sort_order )')
                    .eq('status', 'open')
                    .eq('is_public', true)
                    .eq('is_featured', true)
                    .order('featured_rank', { ascending: true, nullsFirst: false })
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()
            );
            if (!data) return null;
            const studioName = data.sponsor_name || data.client_display_name || 'Oportunidad destacada';
            const initials = studioName.split(/\s+/).filter(Boolean).slice(0, 2)
                .map((part) => part.charAt(0).toUpperCase()).join('');
            return {
                ...data,
                request_id: data.id,
                opportunity_code: data.request_code,
                studio_name: studioName,
                studio_initials: initials || 'WO',
                slots_count: data.featured_slots_count,
                title: data.display_title || data.tattoo_idea_description,
                description: data.sponsor_description || data.tattoo_idea_description,
                city: data.client_city,
                country: data.client_country,
                budget_min: data.client_budget_min,
                budget_max: data.client_budget_max,
                budget_currency: data.client_budget_currency,
                tags: data.featured_tags || [],
                image_url: data.featured_image_url || data.job_board_attachments?.[0]?.file_url || null,
                published_label: 'Publicado hoy',
                cta_label: 'Postularme',
            };
        },
    };

    const SavedRequests = {
        async listForArtist(artistUserId) {
            const { data } = await run('jobboard.saved.listForArtist', (c) =>
                c.from('artist_saved_job_requests')
                    .select('request_id, created_at')
                    .eq('artist_user_id', artistUserId)
                    .order('created_at', { ascending: false })
            );
            return data || [];
        },

        async toggle(requestId, artistUserId, saved) {
            if (saved) {
                try {
                    await run('jobboard.saved.add', (c) =>
                        c.from('artist_saved_job_requests').insert({
                            artist_user_id: artistUserId,
                            request_id: requestId,
                        })
                    );
                } catch (error) {
                    // La tabla es inmutable (sin UPDATE por diseño). Un segundo
                    // guardado concurrente ya alcanzó el estado solicitado.
                    if (error?.code !== '23505' && error?.cause?.code !== '23505') throw error;
                }
            } else {
                await run('jobboard.saved.remove', (c) =>
                    c.from('artist_saved_job_requests')
                        .delete()
                        .eq('artist_user_id', artistUserId)
                        .eq('request_id', requestId)
                );
            }
            return saved;
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

    D.JobBoard = {
        Requests,
        Applications,
        CounterOffers,
        Featured,
        SavedRequests,
        Stats,
        Realtime: JobBoardRealtime,
    };
})();
