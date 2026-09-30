/**
 * WE OTZI - Repositorio del dominio Travel (frontend)
 * ---------------------------------------------------
 * Giras/viajes del artista (/artist/travel) sobre la capa PostgREST unificada.
 * Tablas: artist_trips, trip_studio_links, trip_checklist_items,
 * trip_documents, trip_events y artist_travel_passport_stamps.
 * Corre con la sesión del usuario: RLS protege el itinerario y las decisiones
 * de estudio pasan exclusivamente por RPCs auditados. El artista solicita;
 * el estudio propietario o soporte confirma/rechaza.
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.Travel.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[travel-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const run = D.run;

    const TRIP_EMBED = '*, trip_studio_links ( id, studio_id, studio_name, studio_city, status, requested_at, resolved_at, contact_name, contact_details, address_snapshot ), trip_checklist_items ( id, label, is_done, is_custom, sort_order ), trip_documents ( id, category, file_name, storage_path, created_at ), trip_events ( id, event_type, detail, event_date, created_at )';

    const Travel = {
        // ---- artist_trips ----

        // Todos los viajes del artista, proximos primero.
        async listForArtist(artistUserId, select = '*, trip_studio_links ( id, studio_id, studio_name, studio_city, status, contact_name, contact_details, address_snapshot )') {
            const { data } = await run('travel.listForArtist', (c) =>
                c.from('artist_trips').select(select).eq('artist_user_id', artistUserId).order('start_date', { ascending: false })
            );
            return data || [];
        },

        // Sellos historicos persistidos. RLS limita la lectura al artista
        // propietario; no se derivan de los viajes visibles del año actual.
        async listPassport(artistUserId) {
            const { data } = await run('travel.listPassport', (c) =>
                c.from('artist_travel_passport_stamps')
                    .select('id, artist_user_id, city, country, year, tattoo_count, studio_count')
                    .eq('artist_user_id', artistUserId)
                    .order('year', { ascending: false })
                    .order('city', { ascending: true })
            );
            return data || [];
        },

        // Viaje completo con satelites embebidos (detalle). .maybeSingle().
        async getById(tripId) {
            const { data } = await run('travel.getById', (c) =>
                c.from('artist_trips').select(TRIP_EMBED).eq('id', tripId).maybeSingle()
            );
            return data || null;
        },

        // Itinerario compartido (/travel/t/:slug; query legacy compatible).
        // La proyeccion RPC es una whitelist y nunca da acceso anon directo a
        // artist_trips, notas, condiciones, documentos ni contactos privados.
        async getBySlug(slug) {
            const { data } = await run('travel.getBySlug', (c) =>
                c.rpc('get_public_travel_share', { p_share_slug: slug }).maybeSingle()
            );
            return data || null;
        },

        // Crea viaje + checklist canonica + evento en una sola transaccion. La
        // identidad del artista se toma del JWT; artist_user_id del payload se
        // ignora deliberadamente para impedir asignaciones cruzadas.
        async create(payload) {
            const { data } = await run('travel.create', (c) =>
                c.rpc('create_artist_trip', {
                    p_city: payload.city,
                    p_country: payload.country,
                    p_region: payload.region || null,
                    p_start_date: payload.start_date,
                    p_end_date: payload.end_date,
                    p_trip_type: payload.trip_type,
                    p_studio_name_hint: payload.studio_name_hint || null,
                    p_personal_notes: payload.personal_notes || null,
                })
            );
            return data;
        },

        async update(tripId, patch) {
            await run('travel.update', (c) => c.from('artist_trips').update(patch).eq('id', tripId));
        },

        // Cancelacion recuperable y atomica: cierra solicitudes pendientes,
        // desactiva el share y registra la cronologia sin borrar datos.
        async cancel(tripId, reason = null) {
            const { data } = await run('travel.cancel', (c) =>
                c.rpc('cancel_artist_trip', {
                    p_trip_id: tripId,
                    p_reason: reason || null,
                })
            );
            return data;
        },

        // El estado se deriva en servidor bajo lock; no se confia en un status
        // calculado por el navegador.
        async reactivate(tripId) {
            const { data } = await run('travel.reactivate', (c) =>
                c.rpc('reactivate_artist_trip', { p_trip_id: tripId })
            );
            return data;
        },

        async updateDates(tripId, startDate, endDate) {
            const { data } = await run('travel.updateDates', (c) =>
                c.rpc('update_artist_trip_dates', {
                    p_trip_id: tripId,
                    p_start_date: startDate,
                    p_end_date: endDate,
                })
            );
            return data;
        },

        // Compartir itinerario: slug + flag (slug lo genera el caller).
        async setShare(tripId, { slug, enabled }) {
            await run('travel.setShare', (c) =>
                c.from('artist_trips').update({ share_slug: slug, share_enabled: !!enabled }).eq('id', tripId)
            );
        },

        // ---- trip_studio_links ----

        async requestStudioLink({ tripId, studioId }) {
            const { data } = await run('travel.requestStudioLink', (c) =>
                c.rpc('request_trip_studio_link', {
                    p_trip_id: tripId,
                    p_studio_id: studioId,
                })
            );
            return data;
        },

        // Solo el estudio propietario o soporte puede resolver la solicitud.
        async resolveStudioLink(linkId, action) {
            const { data } = await run('travel.resolveStudioLink', (c) =>
                c.rpc('resolve_trip_studio_link', {
                    p_link_id: linkId,
                    p_action: action,
                })
            );
            return data;
        },

        async listPendingStudioLinks(studioId) {
            const { data } = await run('travel.listPendingStudioLinks', (c) =>
                c.rpc('list_pending_trip_studio_links', { p_studio_id: studioId })
            );
            return (data || []).map((row) => {
                const { artist_trip: artistTrip, ...link } = row;
                return { ...link, artist_trips: artistTrip || null };
            });
        },

        // ---- trip_checklist_items ----

        // Siembra la checklist inicial. `labels` = array de strings en orden
        // (los labels canonicos viven en el modulo de la pagina, junto al Figma).
        async seedChecklist(tripId, labels) {
            if (!labels || !labels.length) return [];
            const rows = labels.map((label, i) => ({ trip_id: tripId, label, sort_order: i }));
            const { data } = await run('travel.seedChecklist', (c) =>
                c.from('trip_checklist_items').insert(rows).select()
            );
            return data || [];
        },

        async addChecklistItem(tripId, label, sortOrder = 999) {
            const { data } = await run('travel.addChecklistItem', (c) =>
                c.from('trip_checklist_items').insert([{ trip_id: tripId, label, is_custom: true, sort_order: sortOrder }]).select().single()
            );
            return data;
        },

        async setChecklistDone(itemId, isDone) {
            await run('travel.setChecklistDone', (c) =>
                c.from('trip_checklist_items').update({ is_done: !!isDone }).eq('id', itemId)
            );
        },

        async deleteChecklistItem(itemId) {
            await run('travel.deleteChecklistItem', (c) => c.from('trip_checklist_items').delete().eq('id', itemId));
        },

        // ---- trip_documents (el upload al bucket artist-trip-docs lo hace la
        // pagina con storage; aqui solo el registro) ----

        async addDocument({ tripId, category, fileName, storagePath }) {
            const { data } = await run('travel.addDocument', (c) =>
                c.from('trip_documents').insert([{ trip_id: tripId, category, file_name: fileName, storage_path: storagePath }]).select().single()
            );
            return data;
        },

        async deleteDocument(documentId) {
            await run('travel.deleteDocument', (c) => c.from('trip_documents').delete().eq('id', documentId));
        },

        // ---- trip_events (cronologia) ----

        async addEvent({ tripId, eventType, detail = null, eventDate = null }) {
            const row = { trip_id: tripId, event_type: eventType, detail };
            if (eventDate) row.event_date = eventDate;
            const { data } = await run('travel.addEvent', (c) =>
                c.from('trip_events').insert([row]).select().single()
            );
            return data;
        },
    };

    D.Travel = Travel;
})();
