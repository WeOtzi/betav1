/**
 * WE OTZI - Repositorio del dominio Travel (frontend)
 * ---------------------------------------------------
 * Giras/viajes del artista (/artist/travel) sobre la capa PostgREST unificada.
 * Tablas: artist_trips, trip_studio_links, trip_checklist_items,
 * trip_documents, trip_events (migracion 20260825100000_artist_travel.sql).
 * Corre con la sesion del usuario: la seguridad la da RLS (dueño total,
 * soporte lectura, viajes compartidos legibles por anon via share_enabled).
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

    const TRIP_EMBED = '*, trip_studio_links ( id, studio_id, studio_name, studio_city, status, requested_at, resolved_at ), trip_checklist_items ( id, label, is_done, is_custom, sort_order ), trip_documents ( id, category, file_name, storage_path, created_at ), trip_events ( id, event_type, detail, event_date, created_at )';

    const Travel = {
        // ---- artist_trips ----

        // Todos los viajes del artista, proximos primero.
        async listForArtist(artistUserId, select = '*, trip_studio_links ( id, studio_name, status )') {
            const { data } = await run('travel.listForArtist', (c) =>
                c.from('artist_trips').select(select).eq('artist_user_id', artistUserId).order('start_date', { ascending: false })
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

        // Itinerario compartido (pagina publica /travel/share?slug=...).
        // Solo devuelve viajes con share_enabled (policy artist_trips_public_shared).
        async getBySlug(slug) {
            const { data } = await run('travel.getBySlug', (c) =>
                c.from('artist_trips')
                    .select('id, artist_user_id, city, country, region, start_date, end_date, trip_type, status, event_name, share_slug')
                    .eq('share_slug', slug)
                    .eq('share_enabled', true)
                    .maybeSingle()
            );
            return data || null;
        },

        // Crea un viaje y lo devuelve (payload incluye artist_user_id).
        async create(payload) {
            const { data } = await run('travel.create', (c) =>
                c.from('artist_trips').insert([payload]).select().single()
            );
            return data;
        },

        async update(tripId, patch) {
            await run('travel.update', (c) => c.from('artist_trips').update(patch).eq('id', tripId));
        },

        // Cancelacion (recuperable): status + cancelled_at, sin borrar datos.
        async cancel(tripId) {
            await run('travel.cancel', (c) =>
                c.from('artist_trips').update({ status: 'cancelado', cancelled_at: new Date().toISOString() }).eq('id', tripId)
            );
        },

        async reactivate(tripId, status = 'planificado') {
            await run('travel.reactivate', (c) =>
                c.from('artist_trips').update({ status, cancelled_at: null }).eq('id', tripId)
            );
        },

        // Compartir itinerario: slug + flag (slug lo genera el caller).
        async setShare(tripId, { slug, enabled }) {
            await run('travel.setShare', (c) =>
                c.from('artist_trips').update({ share_slug: slug, share_enabled: !!enabled }).eq('id', tripId)
            );
        },

        // ---- trip_studio_links ----

        async addStudioLink({ tripId, studioId = null, studioName, studioCity = null }) {
            const { data } = await run('travel.addStudioLink', (c) =>
                c.from('trip_studio_links').insert([{ trip_id: tripId, studio_id: studioId, studio_name: studioName, studio_city: studioCity }]).select().single()
            );
            return data;
        },

        async updateStudioLinkStatus(linkId, status) {
            await run('travel.updateStudioLinkStatus', (c) =>
                c.from('trip_studio_links').update({ status, resolved_at: status === 'esperando_confirmacion' ? null : new Date().toISOString() }).eq('id', linkId)
            );
        },

        async deleteStudioLink(linkId) {
            await run('travel.deleteStudioLink', (c) => c.from('trip_studio_links').delete().eq('id', linkId));
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
