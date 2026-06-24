/**
 * WE OTZI - Repositorios del dominio Estudios (frontend)
 * ------------------------------------------------------
 * Metodos con nombre sobre la capa PostgREST unificada (postgrest-client.js).
 * Reemplazan los `WeotziData.from('studios' | 'studio_locations' |
 * 'studio_artist_memberships' | 'studio_spots' | 'studio_jobs_log' | ...)`
 * dispersos por studio-dashboard.js, studio-dashboard-ops.js, studio-profile.js,
 * studio-register.js, studio-auth.js, studio-spots-directory.js, etc.
 *
 * A DIFERENCIA de quotations-repo.js, estos metodos son WRAPPERS FINOS que
 * DEVUELVEN el builder de supabase-js sin resolver: el llamador sigue recibiendo
 * `{ data, error }` (o `{ data, error, count }`) y conserva su propio manejo de
 * error. No usan `run` ni lanzan. Asi la migracion de los call sites es mecanica.
 *
 * Las columnas FIJAS de cada vista con nombre propio quedan ENCAPSULADAS aqui.
 * Para reads genericos con columnas variables se acepta `columns='*'`.
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.{Studios,
 * StudioLocations, StudioMemberships, StudioSpots, StudioOps}.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.from !== 'function') {
        console.error('[studios-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const from = D.from;

    // Embed FK a artists_db reutilizado por los listados de roster / postulaciones.
    const ARTIST_EMBED = 'artists_db ( user_id, username, name, profile_picture, styles_array, city, country, session_price )';
    // Embed FK a artists_db minimo (selector de artista en editores de ops).
    const ARTIST_EMBED_MIN = 'artists_db(user_id, username, name)';
    // Columnas de direccion estructurada (geocodificada) compartidas por studios
    // y studio_locations.
    const ADDRESS_COLS =
        'country, country_code, state_province, city, locality, street, street_number, ' +
        'unit, postal_code, formatted_address, latitude, longitude, google_place_id';

    // ===================== studios =====================
    const Studios = {
        // --- reads ---

        // Estudio por id. columns variable; .maybeSingle().
        getById(studioId, columns = '*') {
            return from('studios').select(columns).eq('id', studioId).maybeSingle();
        },

        // Solo las columnas de direccion del estudio (borrador de direccion del
        // dashboard del artista). Cubre dashboard.js:724. .maybeSingle().
        getAddressById(studioId) {
            return from('studios').select(ADDRESS_COLS).eq('id', studioId).maybeSingle();
        },

        // Estudio por slug. columns variable; .maybeSingle(). Parte del lookup
        // por id-o-slug del perfil publico (studio-profile.js:40).
        getBySlug(slug, columns = '*') {
            return from('studios').select(columns).eq('slug', slug).maybeSingle();
        },

        // Estudio propiedad del usuario autenticado (panel de estudio). columns
        // variable; .maybeSingle(). Cubre studio-auth.js:42 (select '*'),
        // studio-auth.js:83 (id,user_id,name,slug,profile_complete).
        getByUserId(userId, columns = '*') {
            return from('studios').select(columns).eq('user_id', userId).maybeSingle();
        },

        // Estudio propiedad del usuario, para usarlo como reviewer. Alias semantico
        // de getByUserId con columns de reviews. Cubre reviews.js:350.
        getByOwnerUserId(userId, columns = 'id,user_id,slug,name,logo_image,country') {
            return from('studios').select(columns).eq('user_id', userId).maybeSingle();
        },

        // Verifica ownership: estudio con ese id Y dueno userId (doble filtro).
        // Cubre reviews.js:308. .maybeSingle().
        getOwnedByUser(studioId, userId, columns = 'id,user_id') {
            return from('studios').select(columns).eq('id', studioId).eq('user_id', userId).maybeSingle();
        },

        // Busqueda por nombre normalizado (ilike, mayusculas) para autocompletado.
        // columns variable: por defecto 'id, name, normalized_name' (dashboard) o
        // 'name, normalized_name' / el set largo de register segun el caller.
        // Cubre dashboard.js:1071/1338/2406, register.js:1673.
        searchByNormalizedName(normalizedQuery, { limit = 8, columns = 'id, name, normalized_name' } = {}) {
            return from('studios')
                .select(columns)
                .ilike('normalized_name', `%${normalizedQuery}%`)
                .order('name')
                .limit(limit);
        },

        // id del estudio por nombre normalizado (paso de busqueda del find-or-create).
        // single=false -> .maybeSingle() (primer intento); single=true -> .single()
        // (reintento tras colision 23505). Cubre dashboard.js:2469/2482,
        // register.js:1892/1912.
        findIdByNormalizedName(normalizedName, { single = false } = {}) {
            const q = from('studios').select('id').eq('normalized_name', normalizedName);
            return single ? q.single() : q.maybeSingle();
        },

        // --- inserts ---

        // Crea un estudio minimo (find-or-create). .select('id').single(). Cubre
        // dashboard.js:2476, register.js:1904.
        createMinimal({ name, normalizedName }) {
            return from('studios').insert({ name, normalized_name: normalizedName }).select('id').single();
        },

        // Inserta la fila del estudio en el registro completo (studio-auth.js:130).
        // payload incluye user_id, email, name, normalized_name, slug, ...; devuelve
        // id, slug, name, user_id. .single().
        create(payload) {
            return from('studios').insert(payload).select('id, slug, name, user_id').single();
        },

        // --- updates ---

        // Patch arbitrario del estudio por id. Cubre studio-register.js:282
        // ({website}) y :321 ({primary_location_id, profile_complete}).
        update(studioId, patch) {
            return from('studios').update(patch).eq('id', studioId);
        },

        // Guarda los campos editables del perfil del estudio. Cubre
        // studio-dashboard.js:174. (alias semantico de update).
        updateProfile(studioId, patch) {
            return from('studios').update(patch).eq('id', studioId);
        },

        // Persiste la direccion geocodificada del estudio (incluye geocoded_at).
        // Cubre dashboard.js:2798, register.js:4080.
        updateAddress(studioId, addressPatch) {
            return from('studios').update(addressPatch).eq('id', studioId);
        },

        // Apunta studios.primary_location_id a una sede. Cubre studio-dashboard.js:331.
        setPrimaryLocation(studioId, locationId) {
            return from('studios').update({ primary_location_id: locationId }).eq('id', studioId);
        },
    };

    // ===================== studio_locations =====================
    const StudioLocations = {
        // Todas las sedes del estudio ordenadas por sort_order (pestania Sedes).
        // Cubre studio-dashboard.js:191. columns variable.
        listByStudio(studioId, columns = '*') {
            return from('studio_locations')
                .select(columns)
                .eq('studio_id', studioId)
                .order('sort_order', { ascending: true });
        },

        // Sedes activas del estudio (is_active=true), ordenadas por principal y
        // sort_order. Cubre register.js:1764, studio-dashboard.js:723,
        // studio-profile.js:84. columns variable.
        listActiveByStudio(studioId, columns = '*') {
            return from('studio_locations')
                .select(columns)
                .eq('studio_id', studioId)
                .eq('is_active', true)
                .order('is_primary', { ascending: false })
                .order('sort_order', { ascending: true });
        },

        // Sedes primarias activas con coordenadas y estudio embebido para el mapa.
        // Cubre explore-map.js:653. Embed FK studios:studio_id(...).
        listPrimaryWithStudioForMap() {
            return from('studio_locations')
                .select('id, studio_id, label, is_primary, latitude, longitude, formatted_address, city, country, studios:studio_id(id, slug, name, tagline, cover_image, instagram, website)')
                .eq('is_active', true)
                .eq('is_primary', true)
                .not('latitude', 'is', null);
        },

        // Bulk-fetch de las sedes primarias de varios estudios (resolver coordenadas
        // de itinerario). Cubre explore-globe.js:469. columns variable.
        listPrimaryByStudioIds(studioIds, columns = 'studio_id, latitude, longitude, formatted_address, city, country') {
            return from('studio_locations').select(columns).in('studio_id', studioIds).eq('is_primary', true);
        },

        // Degrada la sede primaria actual antes de promover otra. Cubre
        // studio-dashboard.js:312.
        demotePrimary(studioId) {
            return from('studio_locations').update({ is_primary: false }).eq('studio_id', studioId).eq('is_primary', true);
        },

        // Actualiza una sede existente y la devuelve. Cubre studio-dashboard.js:320.
        // .select().single().
        updateLocation(locationId, patch) {
            return from('studio_locations').update(patch).eq('id', locationId).select().single();
        },

        // Inserta una sede nueva y la devuelve. Cubre studio-dashboard.js:323.
        // payload incluye studio_id. .select().single().
        createLocation(payload) {
            return from('studio_locations').insert(payload).select().single();
        },

        // Inserta en lote las sedes del estudio durante el registro; devuelve
        // id e is_primary. Cubre studio-register.js:313.
        createMany(rows) {
            return from('studio_locations').insert(rows).select('id, is_primary');
        },

        // Elimina una sede por id. Cubre studio-dashboard.js:350.
        deleteLocation(locationId) {
            return from('studio_locations').delete().eq('id', locationId);
        },
    };

    // ===================== studio_artist_memberships =====================
    const StudioMemberships = {
        // Roster del estudio (active/pending/paused) con artista embebido. Cubre
        // studio-dashboard.js:841. Orden por status y role.
        listRoster(studioId) {
            return from('studio_artist_memberships')
                .select(`id, role, status, started_at, ended_at, location_id, revenue_split_pct, ${ARTIST_EMBED}`)
                .eq('studio_id', studioId)
                .in('status', ['active', 'pending_acceptance', 'paused'])
                .order('status', { ascending: true })
                .order('role', { ascending: true });
        },

        // Roster activo con artista embebido para el perfil publico del estudio.
        // Cubre studio-profile.js:95.
        listActiveRosterWithArtists(studioId) {
            return from('studio_artist_memberships')
                .select('role, status, artists_db ( user_id, username, name, profile_picture, styles_array, session_price )')
                .eq('studio_id', studioId)
                .eq('status', 'active');
        },

        // Artistas activos del roster (embed minimo) para selectores de ops. Con
        // withRole=true agrega la columna role. Cubre studio-dashboard-ops.js:134,
        // :660 (sin role) y :860 (con role).
        listActiveArtists(studioId, { withRole = false } = {}) {
            const cols = withRole
                ? `artist_user_id, role, ${ARTIST_EMBED_MIN}`
                : `artist_user_id, ${ARTIST_EMBED_MIN}`;
            return from('studio_artist_memberships')
                .select(cols)
                .eq('studio_id', studioId)
                .eq('status', 'active');
        },

        // Invitaciones pendientes de un artista, con estudio y sede embebidos.
        // Cubre artist-invitations.js:29 (renderPending).
        listPendingForArtist(artistUserId) {
            return from('studio_artist_memberships')
                .select('id, role, status, location_id, invited_at, studios:studio_id ( id, slug, name, tagline, cover_image, logo_image, instagram, primary_location_id ), location:location_id ( id, label, city, country, formatted_address )')
                .eq('artist_user_id', artistUserId)
                .eq('status', 'pending_acceptance')
                .order('invited_at', { ascending: false });
        },

        // Memberships activas de un artista con datos basicos del estudio. Cubre
        // artist-invitations.js:75 (renderActive).
        listActiveForArtist(artistUserId) {
            return from('studio_artist_memberships')
                .select('id, role, status, location_id, started_at, studios:studio_id ( id, slug, name, logo_image )')
                .eq('artist_user_id', artistUserId)
                .eq('status', 'active');
        },

        // Crea una membership directa (al aceptar postulacion). Cubre
        // studio-dashboard.js:644. Tolera 23505 en el caller.
        createMembership(payload) {
            return from('studio_artist_memberships').insert(payload);
        },

        // Crea una invitacion (status pending_acceptance) y devuelve id. Cubre
        // studio-dashboard.js:796. .select('id').single().
        inviteArtist(payload) {
            return from('studio_artist_memberships').insert(payload).select('id').single();
        },

        // Patch arbitrario de una membership (rol, sede, reparto). Cubre
        // studio-dashboard.js:928.
        updateMembership(membershipId, patch) {
            return from('studio_artist_memberships').update(patch).eq('id', membershipId);
        },

        // Finaliza una membership (status 'ended' + ended_at). Cubre
        // studio-dashboard.js:936 y artist-invitations.js:111 (el artista sale).
        endMembership(membershipId) {
            return from('studio_artist_memberships')
                .update({ status: 'ended', ended_at: new Date().toISOString() })
                .eq('id', membershipId);
        },

        // Reactiva una membership finalizada (status 'active', ended_at null).
        // Cubre studio-dashboard.js:961.
        resumeMembership(membershipId) {
            return from('studio_artist_memberships').update({ status: 'active', ended_at: null }).eq('id', membershipId);
        },

        // Elimina (cancela) una membership/invitacion por id. Cubre
        // studio-dashboard.js:957.
        deleteMembership(membershipId) {
            return from('studio_artist_memberships').delete().eq('id', membershipId);
        },

        // El artista responde una invitacion pendiente: action 'accept' ->
        // {status:'active', started_at} ; 'reject' -> {status:'rejected', ended_at}.
        // Doble filtro id + artist_user_id. Cubre artist-invitations.js:123.
        respondToInvitation(membershipId, artistUserId, action) {
            const now = new Date().toISOString();
            const patch = action === 'accept'
                ? { status: 'active', started_at: now }
                : { status: 'rejected', ended_at: now };
            return from('studio_artist_memberships')
                .update(patch)
                .eq('id', membershipId)
                .eq('artist_user_id', artistUserId);
        },
    };

    // ===================== studio_spots (+ applications/attachments) =====================
    const StudioSpots = {
        // --- spots ---

        // Spots del estudio (panel) ordenados por creacion desc. Cubre
        // studio-dashboard.js:370.
        listByStudio(studioId) {
            return from('studio_spots')
                .select('id, title, kind, status, application_count, max_applications, start_date, end_date, revenue_split_pct, stipend_amount, stipend_currency, created_at')
                .eq('studio_id', studioId)
                .order('created_at', { ascending: false });
        },

        // Directorio publico de spots abiertos con estudio y sede embebidos. Cubre
        // studio-spots-directory.js:29.
        listOpenWithStudioAndLocation() {
            return from('studio_spots')
                .select('id, title, kind, description, styles_wanted, language_requirements, experience_min_years, includes_housing, revenue_split_pct, stipend_amount, stipend_currency, start_date, end_date, weeks_minimum, weeks_maximum, application_count, max_applications, expires_at, cover_image, studios:studio_id ( id, slug, name, tagline, cover_image, instagram, primary_location_id ), location:location_id ( id, label, city, country, formatted_address, latitude, longitude )')
                .eq('status', 'open')
                .order('created_at', { ascending: false });
        },

        // Spots abiertos (con estudio/sede embebidos) para el hero del dashboard
        // del artista; limit 12. Cubre dashboard-redesign.js:307.
        listOpenForDashboard() {
            return from('studio_spots')
                .select('id, title, kind, styles_wanted, start_date, status, studios:studio_id(name), location:location_id(city, country, label)')
                .eq('status', 'open')
                .order('created_at', { ascending: false })
                .limit(12);
        },

        // Spot completo por id (editor). Cubre studio-dashboard.js:417.
        // .maybeSingle().
        getById(spotId, columns = '*') {
            return from('studio_spots').select(columns).eq('id', spotId).maybeSingle();
        },

        // Datos minimos del spot (titulo, kind) al abrir postulaciones. Cubre
        // studio-dashboard.js:580. .single().
        getSummaryById(spotId) {
            return from('studio_spots').select('id, title, kind').eq('id', spotId).single();
        },

        // Actualiza un spot y lo devuelve. Cubre studio-dashboard.js:532.
        // .select().single().
        updateSpot(spotId, payload) {
            return from('studio_spots').update(payload).eq('id', spotId).select().single();
        },

        // Inserta un spot y lo devuelve (payload incluye studio_id). Cubre
        // studio-dashboard.js:533. .select().single().
        createSpot(payload) {
            return from('studio_spots').insert(payload).select().single();
        },

        // Cambia solo el status de un spot. Cubre studio-dashboard.js:423.
        updateStatus(spotId, status) {
            return from('studio_spots').update({ status }).eq('id', spotId);
        },

        // Elimina un spot por id. Cubre studio-dashboard.js:428.
        deleteSpot(spotId) {
            return from('studio_spots').delete().eq('id', spotId);
        },

        // --- attachments (studio_spot_attachments) ---

        // Borra los adjuntos previos de un spot. Cubre studio-dashboard.js:548.
        deleteAttachmentsBySpot(spotId) {
            return from('studio_spot_attachments').delete().eq('spot_id', spotId);
        },

        // Registra un adjunto (portada) del spot. Cubre studio-dashboard.js:568.
        insertAttachment(attachment) {
            return from('studio_spot_attachments').insert(attachment);
        },

        // --- applications (studio_spot_applications) ---

        // Postulaciones de un spot con artista embebido (panel de revision). Cubre
        // studio-dashboard.js:581. Orden por creacion desc.
        listApplications(spotId) {
            return from('studio_spot_applications')
                .select('id, status, message, portfolio_url, created_at, decided_at, artists_db ( user_id, username, name, profile_picture, styles_array, city, country, session_price )')
                .eq('spot_id', spotId)
                .order('created_at', { ascending: false });
        },

        // Comprueba si un artista ya aplico a un spot (evitar duplicado). Cubre
        // studio-spots-directory.js:212. .maybeSingle().
        getApplication(spotId, artistUserId) {
            return from('studio_spot_applications').select('id, status').eq('spot_id', spotId).eq('artist_user_id', artistUserId).maybeSingle();
        },

        // Crea una postulacion del artista a un spot. Cubre
        // studio-spots-directory.js:265.
        createApplication({ spotId, artistUserId, message, portfolioUrl }) {
            return from('studio_spot_applications').insert({ spot_id: spotId, artist_user_id: artistUserId, message, portfolio_url: portfolioUrl });
        },

        // Acepta/rechaza una postulacion (status + decided_at). Cubre
        // studio-dashboard.js:634.
        decideApplication(applicationId, status) {
            return from('studio_spot_applications').update({ status, decided_at: new Date().toISOString() }).eq('id', applicationId);
        },
    };

    // ===================== StudioOps (jobs, invoices, documents, inventory, suppliers, sponsors, vistas) =====================
    const StudioOps = {
        // ---- studio_jobs_log ----

        // Ultimos N trabajos del estudio con artista embebido (tabla de jobs).
        // Cubre studio-dashboard-ops.js:90.
        listJobs(studioId, { limit = 100 } = {}) {
            return from('studio_jobs_log')
                .select('id, performed_at, duration_hours, gross_amount, gross_currency, artist_split_amount, studio_split_amount, status, notes, artists_db ( username, name )')
                .eq('studio_id', studioId)
                .order('performed_at', { ascending: false })
                .limit(limit);
        },

        // Trabajos del estudio para agregacion de clientes. Cubre
        // studio-dashboard-ops.js:210.
        listJobsForClientAggregation(studioId) {
            return from('studio_jobs_log')
                .select('client_user_id, client_display_name, client_email, gross_amount, gross_currency, performed_at')
                .eq('studio_id', studioId);
        },

        // Fila completa de un trabajo por id (editor). Cubre studio-dashboard-ops.js:121.
        getJobById(id) {
            return from('studio_jobs_log').select('*').eq('id', id).single();
        },

        // Actualiza un trabajo y lo devuelve. Cubre studio-dashboard-ops.js:191.
        updateJob(id, patch) {
            return from('studio_jobs_log').update(patch).eq('id', id).select().single();
        },

        // Inserta un trabajo y lo devuelve. Cubre studio-dashboard-ops.js:192.
        createJob(payload) {
            return from('studio_jobs_log').insert(payload).select().single();
        },

        // Elimina un trabajo por id. Cubre studio-dashboard-ops.js:125.
        deleteJob(id) {
            return from('studio_jobs_log').delete().eq('id', id);
        },

        // ---- studio_invoices ----

        // Facturas del estudio ordenadas por emision desc. Cubre studio-dashboard-ops.js:252.
        listInvoices(studioId) {
            return from('studio_invoices').select('*').eq('studio_id', studioId).order('issue_date', { ascending: false });
        },

        // Factura completa por id (editor). Cubre studio-dashboard-ops.js:281.
        getInvoiceById(id) {
            return from('studio_invoices').select('*').eq('id', id).single();
        },

        // Actualiza la cabecera de una factura y la devuelve. Cubre studio-dashboard-ops.js:363.
        updateInvoice(id, headerPatch) {
            return from('studio_invoices').update(headerPatch).eq('id', id).select().single();
        },

        // Inserta una factura y la devuelve. Cubre studio-dashboard-ops.js:364.
        createInvoice(headerPayload) {
            return from('studio_invoices').insert(headerPayload).select().single();
        },

        // Marca una factura como pagada (status='paid', paid_at=now). Cubre
        // studio-dashboard-ops.js:284.
        markInvoicePaid(id) {
            return from('studio_invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', id);
        },

        // Elimina una factura por id. Cubre studio-dashboard-ops.js:288.
        deleteInvoice(id) {
            return from('studio_invoices').delete().eq('id', id);
        },

        // ---- studio_invoice_items ----

        // Items de una factura ordenados por sort_order. Cubre studio-dashboard-ops.js:297.
        listInvoiceItems(invoiceId) {
            return from('studio_invoice_items').select('*').eq('invoice_id', invoiceId).order('sort_order');
        },

        // Inserta el set de items de la factura (bulk). Cubre studio-dashboard-ops.js:379.
        insertInvoiceItems(itemRows) {
            return from('studio_invoice_items').insert(itemRows);
        },

        // Borra todos los items de una factura (wipe+reinsert). Cubre
        // studio-dashboard-ops.js:369.
        deleteInvoiceItems(invoiceId) {
            return from('studio_invoice_items').delete().eq('invoice_id', invoiceId);
        },

        // ---- studio_documents ----

        // Documentos del estudio ordenados por creacion desc. Cubre studio-dashboard-ops.js:397.
        listDocuments(studioId) {
            return from('studio_documents').select('*').eq('studio_id', studioId).order('created_at', { ascending: false });
        },

        // Documento completo por id (editor). Cubre studio-dashboard-ops.js:425.
        getDocumentById(id) {
            return from('studio_documents').select('*').eq('id', id).single();
        },

        // Actualiza un documento y lo devuelve. Cubre studio-dashboard-ops.js:490.
        updateDocument(id, patch) {
            return from('studio_documents').update(patch).eq('id', id).select().single();
        },

        // Inserta un documento y lo devuelve. Cubre studio-dashboard-ops.js:491.
        createDocument(payload) {
            return from('studio_documents').insert(payload).select().single();
        },

        // Elimina un documento por id. Cubre studio-dashboard-ops.js:429.
        deleteDocument(id) {
            return from('studio_documents').delete().eq('id', id);
        },

        // ---- studio_inventory_items ----

        // Items activos de inventario con proveedor embebido. Cubre studio-dashboard-ops.js:508.
        listInventoryItems(studioId) {
            return from('studio_inventory_items')
                .select('id, name, sku, category, unit, quantity_on_hand, reorder_level, cost_per_unit, currency, supplier_id, studio_suppliers ( name )')
                .eq('studio_id', studioId)
                .eq('is_active', true)
                .order('name', { ascending: true });
        },

        // Item de inventario completo por id (editor). Cubre studio-dashboard-ops.js:546.
        getInventoryItemById(id) {
            return from('studio_inventory_items').select('*').eq('id', id).single();
        },

        // Actualiza un item de inventario y lo devuelve. Cubre studio-dashboard-ops.js:650.
        updateInventoryItem(id, patch) {
            return from('studio_inventory_items').update(patch).eq('id', id).select().single();
        },

        // Inserta un item de inventario y lo devuelve. Cubre studio-dashboard-ops.js:651.
        createInventoryItem(payload) {
            return from('studio_inventory_items').insert(payload).select().single();
        },

        // Elimina un item de inventario por id (cascada a movimientos). Cubre
        // studio-dashboard-ops.js:552.
        deleteInventoryItem(id) {
            return from('studio_inventory_items').delete().eq('id', id);
        },

        // ---- studio_inventory_movements ----

        // Registra un movimiento de stock. Cubre studio-dashboard-ops.js:702.
        createInventoryMovement(payload) {
            return from('studio_inventory_movements').insert(payload);
        },

        // ---- studio_inventory_health_view ----

        // Vista de salud de inventario (alertas de reorder / valor de stock). Cubre
        // studio-dashboard-ops.js:567.
        listInventoryHealth(studioId) {
            return from('studio_inventory_health_view')
                .select('id, name, quantity_on_hand, reorder_level, needs_reorder, stock_value, currency')
                .eq('studio_id', studioId)
                .order('needs_reorder', { ascending: false });
        },

        // ---- studio_suppliers ----

        // Proveedores del estudio ordenados por nombre. Cubre studio-dashboard-ops.js:719.
        listSuppliers(studioId) {
            return from('studio_suppliers').select('*').eq('studio_id', studioId).order('name');
        },

        // Opciones de proveedor (id, name) para selectores. Cubre studio-dashboard-ops.js:604.
        listSupplierOptions(studioId) {
            return from('studio_suppliers').select('id,name').eq('studio_id', studioId).order('name');
        },

        // Proveedor completo por id (editor). Cubre studio-dashboard-ops.js:745.
        getSupplierById(id) {
            return from('studio_suppliers').select('*').eq('id', id).single();
        },

        // Actualiza un proveedor y lo devuelve. Cubre studio-dashboard-ops.js:788.
        updateSupplier(id, patch) {
            return from('studio_suppliers').update(patch).eq('id', id).select().single();
        },

        // Inserta un proveedor y lo devuelve. Cubre studio-dashboard-ops.js:789.
        createSupplier(payload) {
            return from('studio_suppliers').insert(payload).select().single();
        },

        // Elimina un proveedor por id. Cubre studio-dashboard-ops.js:749.
        deleteSupplier(id) {
            return from('studio_suppliers').delete().eq('id', id);
        },

        // ---- studio_sponsors ----

        // Sponsors del estudio ordenados por tier desc. Cubre studio-dashboard-ops.js:806.
        listSponsors(studioId) {
            return from('studio_sponsors').select('*').eq('studio_id', studioId).order('tier', { ascending: false });
        },

        // Sponsors publicos visibles de un estudio (vista). Cubre studio-profile.js:183.
        listPublicSponsors(studioId) {
            return from('studio_public_sponsors_view')
                .select('id, studio_id, name, tier, logo_url, website, ends_on')
                .eq('studio_id', studioId)
                .order('tier', { ascending: false });
        },

        // Sponsor completo por id (editor). Cubre studio-dashboard-ops.js:847.
        getSponsorById(id) {
            return from('studio_sponsors').select('*').eq('id', id).single();
        },

        // Actualiza un sponsor y lo devuelve. Cubre studio-dashboard-ops.js:946.
        updateSponsor(id, patch) {
            return from('studio_sponsors').update(patch).eq('id', id).select().single();
        },

        // Inserta un sponsor y lo devuelve. Cubre studio-dashboard-ops.js:947.
        createSponsor(payload) {
            return from('studio_sponsors').insert(payload).select().single();
        },

        // Elimina un sponsor por id. Cubre studio-dashboard-ops.js:851.
        deleteSponsor(id) {
            return from('studio_sponsors').delete().eq('id', id);
        },

        // ---- studio_sponsor_artists ----

        // Vinculos sponsor-artista (con artista embebido) para varios sponsors.
        // Cubre studio-dashboard-ops.js:811, studio-profile.js:195.
        listSponsorArtistsBySponsorIds(sponsorIds) {
            return from('studio_sponsor_artists')
                .select('sponsor_id, artist_user_id, artists_db ( user_id, username, name )')
                .in('sponsor_id', sponsorIds);
        },

        // Solo los artist_user_id vinculados a un sponsor (precarga de checkboxes).
        // Cubre studio-dashboard-ops.js:866.
        listSponsorArtistIds(sponsorId) {
            return from('studio_sponsor_artists').select('artist_user_id').eq('sponsor_id', sponsorId);
        },

        // Inserta los vinculos sponsor-artista (bulk). Cubre studio-dashboard-ops.js:969.
        insertSponsorArtists(rows) {
            return from('studio_sponsor_artists').insert(rows);
        },

        // Borra todos los vinculos de un sponsor (wipe+reinsert). Cubre
        // studio-dashboard-ops.js:965.
        deleteSponsorArtists(sponsorId) {
            return from('studio_sponsor_artists').delete().eq('sponsor_id', sponsorId);
        },

        // ---- vistas de analitica ----

        // Metricas mensuales del estudio (ultimos N meses). Cubre studio-dashboard-ops.js:982.
        getDashboardMetrics(studioId, { months = 12 } = {}) {
            return from('studio_dashboard_metrics_view')
                .select('*')
                .eq('studio_id', studioId)
                .order('month', { ascending: false })
                .limit(months);
        },

        // Rendimiento por artista (top N por bruto facturado). Cubre studio-dashboard-ops.js:983.
        getArtistPerformance(studioId, { limit = 20 } = {}) {
            return from('studio_artist_performance_view')
                .select('*')
                .eq('studio_id', studioId)
                .order('gross_billed', { ascending: false })
                .limit(limit);
        },
    };

    D.Studios = Studios;
    D.StudioLocations = StudioLocations;
    D.StudioMemberships = StudioMemberships;
    D.StudioSpots = StudioSpots;
    D.StudioOps = StudioOps;
})();
