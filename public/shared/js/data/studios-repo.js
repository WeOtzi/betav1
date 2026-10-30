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
 * Plataforma de Estudios (docs/plans/2026-10-30-estudios-plataforma.md) suma:
 *   - tablas: studio_membership_request_details, studio_invitation_change_requests,
 *     studio_spot_counter_offers, studio_claim_requests, supply_products (embed);
 *   - vistas: studio_public_roster, studio_artist_material_balance,
 *     studio_material_assignment_monthly;
 *   - RPCs: request_studio_membership, decide_studio_membership_request,
 *     withdraw_studio_membership_request, decide_studio_spot_application,
 *     check_studio_booking_availability, list_studio_artist_busy_blocks,
 *     list_my_studio_material_assignments, list_unowned_studios,
 *     request_studio_claim.
 * Esas migraciones pueden NO estar aplicadas: los metodos nuevos que corren al
 * cargar una pantalla devuelven `{ data: [] | null, error: null, unavailable: true }`
 * ante un error de "migracion pendiente", y las variantes V2 reintentan sin las
 * columnas nuevas (`legacy: true`). Los metodos nuevos nunca lanzan.
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
    const client = () => D.getClient();
    async function allRows(buildQuery) {
        const rows = [];
        for (let offset = 0; ; offset += 500) {
            const result = await buildQuery().range(offset, offset + 499);
            if (result.error) return result;
            rows.push(...(result.data || []));
            if ((result.data || []).length < 500) return { data: rows, error: null };
        }
    }

    // Embed FK a artists_db reutilizado por los listados de roster / postulaciones.
    const ARTIST_EMBED = 'artists_db ( user_id, username, name, profile_picture, styles_array, city, country, session_price )';
    // Embed FK a artists_db minimo (selector de artista en editores de ops).
    const ARTIST_EMBED_MIN = 'artists_db(user_id, username, name)';
    // Columnas de direccion estructurada (geocodificada) compartidas por studios
    // y studio_locations.
    const ADDRESS_COLS =
        'country, country_code, state_province, city, locality, street, street_number, ' +
        'unit, postal_code, formatted_address, latitude, longitude, google_place_id';

    // ---- helpers de la plataforma de estudios (metodos nuevos) ----

    // Codigos de "falta aplicar una migracion" (Reglas transversales §5):
    // relacion/embed, funcion, columna o tabla ausentes en PostgREST o Postgres.
    const MISSING_SCHEMA_CODES = ['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42703', '42883', '42P01'];
    // Columna o embed nuevo ausente: las variantes V2 reintentan sin ellos.
    const MISSING_COLUMN_CODES = ['42703', 'PGRST204', 'PGRST200'];
    // Vista o tabla nueva ausente.
    const MISSING_RELATION_CODES = ['42P01', 'PGRST205'];
    function errorCode(error) {
        if (!error) return '';
        return String(error.code || (error.cause && error.cause.code) || '');
    }
    function isMissingSchema(error) { return MISSING_SCHEMA_CODES.indexOf(errorCode(error)) !== -1; }
    function isMissingColumn(error) { return MISSING_COLUMN_CODES.indexOf(errorCode(error)) !== -1; }
    function isMissingRelation(error) { return MISSING_RELATION_CODES.indexOf(errorCode(error)) !== -1; }

    // Devuelve el builder sin resolver; si armarlo lanza (sin cliente), una
    // promesa ya resuelta con { data: null, error }. Nunca lanza.
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
    // Resuelve un builder (o una promesa de { data, error }) sin lanzar.
    async function settle(build) {
        try {
            const result = await build();
            return result || { data: null, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }
    // Lectura que corre al cargar una pantalla: traga la "migracion pendiente"
    // y deja la UI vacia (`unavailable: true`); cualquier otro error sube.
    async function soft(build, empty) {
        const result = await settle(build);
        if (result.error && isMissingSchema(result.error)) return { data: empty, error: null, unavailable: true };
        return result;
    }
    // Filtro de status: string -> eq, array -> in, vacio -> sin filtro.
    function byStatus(query, status, column = 'status') {
        if (Array.isArray(status)) return status.length ? query.in(column, status) : query;
        return status ? query.eq(column, status) : query;
    }
    // Aplica `fn` a cada fila de un resultado exitoso.
    function mapRows(result, fn) {
        if (!result || result.error || !Array.isArray(result.data)) return result;
        return { ...result, data: result.data.map(fn) };
    }
    // Primer dia del mes de una fecha 'YYYY-MM-DD' (las vistas mensuales
    // guardan `month` como el dia 1).
    function monthStart(value) {
        const text = String(value || '');
        return /^\d{4}-\d{2}/.test(text) ? `${text.slice(0, 7)}-01` : value;
    }
    // Defaults de las columnas de M1/M2 cuando la migracion no esta aplicada
    // (`initiated_by` ausente equivale a 'studio').
    function withMembershipDefaults(row) {
        return { ...row, initiated_by: row.initiated_by || 'studio', current_contract_id: row.current_contract_id || null };
    }

    // Embeds de la plataforma de estudios.
    const REQUEST_DETAILS_EMBED =
        'studio_membership_request_details ( message, portfolio_url, proposed_start_date, styles, created_at )';
    const REQUEST_ARTIST_EMBED = 'artists_db ( user_id, name, username, profile_picture, styles_array )';
    const PUBLIC_ROSTER_ARTIST_COLS = 'user_id, username, name, profile_picture, styles_array, session_price';
    // artists_db expone los estilos como styles_array; las solicitudes los
    // exponen ademas como `styles` (nombre del contrato).
    function withArtistStyles(row) {
        const artist = row && row.artists_db;
        if (!artist) return row;
        return { ...row, artists_db: { ...artist, styles: artist.styles_array || [] } };
    }

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

        // Busqueda simple del directorio para "Vincular un estudio" de Travel
        // (/artist/travel, frame 173:26741). ilike sobre name (case-insensitive,
        // sin normalizar) con ciudad/pais para la fila de resultado. Devuelve el
        // builder sin resolver (estilo { data, error } del repo).
        searchDirectory(query, { limit = 8, columns = 'id, name, city, country' } = {}) {
            return from('studios')
                .select(columns)
                .ilike('name', `%${query}%`)
                .order('name')
                .limit(limit);
        },

        // Autocompletado de estudios para Crear viaje. A diferencia de la
        // búsqueda administrativa, esta superficie solo puede proponer
        // estudios públicos ya dados de alta y con su perfil completo.
        searchTravelDirectory(query, {
            limit = 8,
            columns = 'id, name, city, country, formatted_address, latitude, longitude',
        } = {}) {
            return from('studios')
                .select(columns)
                .eq('is_active', true)
                .eq('profile_complete', true)
                .not('user_id', 'is', null)
                .ilike('name', `%${query}%`)
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

        // --- reclamo de estudio (studio_claim_requests, M1) ---

        // Estudios del catalogo sin dueno (registro: "¿Tu estudio ya figura en
        // We Ötzi?"). La RPC exige >= 2 caracteres: con menos no se consulta.
        // Sin la migracion devuelve [] con `unavailable: true`.
        listUnownedStudios(query) {
            const text = String(query == null ? '' : query).trim();
            if (text.length < 2) return Promise.resolve({ data: [], error: null });
            return soft(() => rpc('list_unowned_studios', { p_query: text }), []);
        },

        // Pide la titularidad de un estudio sin dueno. Devuelve el id del reclamo.
        requestClaim(studioId, evidence, contactName, contactPhone) {
            return rpc('request_studio_claim', {
                p_studio_id: studioId,
                p_evidence: evidence,
                p_contact_name: contactName || null,
                p_contact_phone: contactPhone || null,
            });
        },

        // Ultimo reclamo del usuario autenticado (pending/approved/rejected) con
        // el estudio embebido, o null. Filtra por el uid de la sesion porque la
        // RLS le deja ver todos los reclamos a soporte.
        async getMyClaim() {
            let uid = null;
            try {
                const auth = client() && client().auth;
                if (auth && typeof auth.getSession === 'function') {
                    const { data } = await auth.getSession();
                    uid = data && data.session && data.session.user ? data.session.user.id : null;
                }
            } catch (error) {
                uid = null;
            }
            return soft(() => {
                let query = from('studio_claim_requests')
                    .select('id, studio_id, user_id, status, evidence, contact_name, contact_phone, created_at, decided_at, decision_note, studios:studio_id ( id, name, slug, city, country, logo_image )');
                if (uid) query = query.eq('user_id', uid);
                return query.order('created_at', { ascending: false }).limit(1).maybeSingle();
            }, null);
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
        // Lee de la vista publica studio_public_roster (M1: no expone
        // revenue_split_pct ni notes). Si la vista no existe (42P01/PGRST205),
        // cae a la tabla como antes. Si existe pero PostgREST no infiere el
        // embed (PGRST200), resuelve los artistas con un segundo read.
        // Filas: { id, membership_id, studio_id, artist_user_id, location_id,
        // role, status: 'active', started_at, ends_on, artists_db }.
        async listActiveRosterWithArtists(studioId) {
            const viewCols = 'membership_id, studio_id, artist_user_id, location_id, role, started_at, ends_on';
            const fromView = (row) => ({ ...row, id: row.membership_id, status: 'active' });
            const view = await settle(() => from('studio_public_roster')
                .select(`${viewCols}, artists_db ( ${PUBLIC_ROSTER_ARTIST_COLS} )`)
                .eq('studio_id', studioId));
            if (!view.error) return mapRows(view, fromView);
            if (errorCode(view.error) === 'PGRST200') {
                const bare = await settle(() => from('studio_public_roster').select(viewCols).eq('studio_id', studioId));
                if (bare.error) return bare;
                const rows = bare.data || [];
                const ids = Array.from(new Set(rows.map((row) => row.artist_user_id).filter(Boolean)));
                const artists = ids.length
                    ? await settle(() => from('artists_db').select(PUBLIC_ROSTER_ARTIST_COLS).in('user_id', ids))
                    : { data: [], error: null };
                if (artists.error) return artists;
                const byId = new Map((artists.data || []).map((artist) => [artist.user_id, artist]));
                return { data: rows.map((row) => ({ ...fromView(row), artists_db: byId.get(row.artist_user_id) || null })), error: null };
            }
            if (!isMissingRelation(view.error)) return view;
            const legacy = await settle(() => from('studio_artist_memberships')
                .select('id, artist_user_id, location_id, role, status, started_at, artists_db ( user_id, username, name, profile_picture, styles_array, session_price )')
                .eq('studio_id', studioId)
                .eq('status', 'active'));
            return mapRows(legacy, (row) => ({ ...row, membership_id: row.id, studio_id: studioId, ends_on: null }));
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

        // Columnas de una invitacion/membership vista desde el artista: incluye
        // `notes` (el mensaje del estudio) y `revenue_split_pct` (la condicion
        // economica), que la pagina de invitaciones muestra en la card y el detalle.
        INVITE_COLS:
            'id, role, status, location_id, invited_at, started_at, ended_at, revenue_split_pct, notes, ' +
            'studios:studio_id ( id, slug, name, tagline, bio, cover_image, logo_image, photo_feed_items, instagram, website, primary_location_id ), ' +
            'location:location_id ( id, label, city, country, formatted_address ), ' +
            'invitation_details:studio_membership_invitation_details ( is_featured, styles, response_due_at, proposed_start_date, duration_label, benefits, studio_provides, artist_expectations, requirements, acceptance_steps, contact_name, contact_email, contact_title, message )',

        // Invitaciones pendientes de un artista, con estudio y sede embebidos.
        // Cubre artist-invitations.js (renderPending).
        listPendingForArtist(artistUserId) {
            return from('studio_artist_memberships')
                .select(StudioMemberships.INVITE_COLS)
                .eq('artist_user_id', artistUserId)
                .in('status', ['pending_invite', 'pending_acceptance'])
                .order('invited_at', { ascending: false });
        },

        // Memberships activas de un artista (mismo set de columnas que las
        // invitaciones: la pagina las muestra como cards del mismo listado).
        listActiveForArtist(artistUserId) {
            return from('studio_artist_memberships')
                .select(StudioMemberships.INVITE_COLS)
                .eq('artist_user_id', artistUserId)
                .eq('status', 'active');
        },

        // Invitaciones que el artista rechazo (estado 'rejected' del enum de
        // status). Cubre la pestania RECHAZADAS de artist-invitations.js.
        listRejectedForArtist(artistUserId) {
            return from('studio_artist_memberships')
                .select(StudioMemberships.INVITE_COLS)
                .eq('artist_user_id', artistUserId)
                .eq('status', 'rejected')
                .order('ended_at', { ascending: false });
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
            return client().rpc('end_studio_membership', { p_membership_id: membershipId });
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
            void artistUserId; // ownership is verified server-side from auth.uid()
            return client().rpc('respond_to_studio_invitation', {
                p_membership_id: membershipId,
                p_action: action,
            });
        },

        // Solicita cambios sobre una invitacion pendiente. El RPC valida
        // ownership, estado y longitud, y conserva un historial auditable.
        requestChanges(membershipId, artistUserId, message) {
            void artistUserId;
            return client().rpc('request_studio_invitation_changes', {
                p_membership_id: membershipId,
                p_message: message,
            });
        },

        // --- alta en dos sentidos (M1) ---

        // Solicitudes de alta pendientes (status 'requested', las pidio el
        // artista) con studio_membership_request_details y artists_db
        // embebidos; artists_db.styles replica styles_array. Badge/pestania
        // Solicitudes: sin la migracion devuelve [] con `unavailable: true`.
        listRequestsForStudio(studioId) {
            return soft(() => allRows(() => from('studio_artist_memberships')
                .select(`id, studio_id, artist_user_id, role, status, location_id, invited_at, initiated_by, ${REQUEST_DETAILS_EMBED}, ${REQUEST_ARTIST_EMBED}`)
                .eq('studio_id', studioId)
                .eq('status', 'requested')
                .order('invited_at', { ascending: false })
                .order('id')), []).then((result) => mapRows(result, withArtistStyles));
        },

        // El artista pide sumarse a un estudio. Devuelve
        // { membership_id, studio_has_owner }.
        requestMembership({ studioId, role = 'resident', locationId = null, message = null, portfolioUrl = null, proposedStartDate = null } = {}) {
            return rpc('request_studio_membership', {
                p_studio_id: studioId,
                p_role: role || 'resident',
                p_location_id: locationId || null,
                p_message: message || null,
                p_portfolio_url: portfolioUrl || null,
                p_proposed_start_date: proposedStartDate || null,
            });
        },

        // El estudio (o soporte) decide una solicitud: decision 'accept' |
        // 'reject'; rol y sede opcionales al aprobar. Devuelve
        // { membership_id, status, artist_user_id, studio_id }.
        decideRequest(membershipId, decision, { role = null, locationId = null } = {}) {
            return rpc('decide_studio_membership_request', {
                p_membership_id: membershipId,
                p_decision: decision,
                p_role: role || null,
                p_location_id: locationId || null,
            });
        },

        // El artista retira su solicitud (requested -> ended).
        withdrawRequest(membershipId) {
            return rpc('withdraw_studio_membership_request', { p_membership_id: membershipId });
        },

        // Solicitudes enviadas por el artista (status 'requested') con el
        // estudio embebido, incluido studios.user_id: `studio_has_owner` dice
        // si el estudio ya tiene cuenta. Sin la migracion: [] + `unavailable`.
        listRequestsForArtist(artistUserId) {
            return soft(() => from('studio_artist_memberships')
                .select(`id, studio_id, artist_user_id, role, status, location_id, invited_at, ended_at, initiated_by, ${REQUEST_DETAILS_EMBED}, ` +
                    'studios:studio_id ( id, slug, name, logo_image, cover_image, city, country, user_id ), ' +
                    'location:location_id ( id, label, city, country, formatted_address )')
                .eq('artist_user_id', artistUserId)
                .eq('status', 'requested')
                .order('invited_at', { ascending: false }), [])
                .then((result) => mapRows(result, (row) => ({ ...row, studio_has_owner: !!(row.studios && row.studios.user_id) })));
        },

        // Cambios pedidos por artistas sobre invitaciones del estudio (pending),
        // con la membresia (studio_artist_memberships) y el artista embebidos.
        listChangeRequestsForStudio(studioId) {
            return soft(() => allRows(() => from('studio_invitation_change_requests')
                .select(`id, membership_id, artist_user_id, message, status, created_at, studio_artist_memberships!inner ( id, studio_id, role, status, location_id, revenue_split_pct, invited_at ), ${REQUEST_ARTIST_EMBED}`)
                .eq('studio_artist_memberships.studio_id', studioId)
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .order('id')), []).then((result) => mapRows(result, withArtistStyles));
        },

        // Cierra un pedido de cambios sin aplicarlo (la RLS lo permite al
        // estudio). Devuelve las filas tocadas: [] si ya estaba cerrado.
        closeChangeRequest(id) {
            return guard(() => from('studio_invitation_change_requests')
                .update({ status: 'declined', resolved_at: new Date().toISOString() })
                .eq('id', id)
                .eq('status', 'pending')
                .select('id, status'));
        },

        // Memberships del artista (INVITE_COLS + initiated_by y
        // current_contract_id). `status` opcional: string o array. Sin M1/M2
        // reintenta con INVITE_COLS y completa initiated_by='studio',
        // current_contract_id=null (`legacy: true`). Los metodos existentes
        // (listPendingForArtist, ...) no cambian.
        async listForArtistV2(artistUserId, { status = null } = {}) {
            const build = (cols) => byStatus(from('studio_artist_memberships')
                .select(cols)
                .eq('artist_user_id', artistUserId), status)
                .order('invited_at', { ascending: false, nullsFirst: false })
                .order('id');
            const full = await settle(() => build(`${StudioMemberships.INVITE_COLS}, initiated_by, current_contract_id`));
            if (!full.error || !isMissingColumn(full.error)) return full;
            const legacy = await settle(() => build(StudioMemberships.INVITE_COLS));
            if (legacy.error) return legacy;
            return { ...mapRows(legacy, withMembershipDefaults), legacy: true };
        },

        // Mismas columnas y filtro que listRoster + initiated_by y
        // current_contract_id (el roster bloquea rol/split con contrato). Sin
        // M1/M2 cae a listRoster y completa los defaults (`legacy: true`).
        async listRosterV2(studioId) {
            const full = await settle(() => from('studio_artist_memberships')
                .select(`id, role, status, started_at, ended_at, location_id, revenue_split_pct, initiated_by, current_contract_id, ${ARTIST_EMBED}`)
                .eq('studio_id', studioId)
                .in('status', ['active', 'pending_acceptance', 'paused'])
                .order('status', { ascending: true })
                .order('role', { ascending: true }));
            if (!full.error || !isMissingColumn(full.error)) return full;
            const legacy = await settle(() => StudioMemberships.listRoster(studioId));
            if (legacy.error) return legacy;
            return { ...mapRows(legacy, withMembershipDefaults), legacy: true };
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
        // studio-spots-directory.js:29. El embed de studios incluye website,
        // logo_image y photo_feed_items para la galeria y la fila de redes del
        // detalle del spot (ref Figma 06).
        listOpenWithStudioAndLocation() {
            return from('studio_spots')
                .select('id, title, kind, description, styles_wanted, language_requirements, experience_min_years, includes_housing, revenue_split_pct, stipend_amount, stipend_currency, stipend_frequency, start_date, end_date, weeks_minimum, weeks_maximum, application_count, max_applications, expires_at, cover_image, is_featured, featured_rank, directory_rank, studio_includes, artist_expectations, minimum_requirements, contact_name, contact_title, response_sla_label, attachments:studio_spot_attachments ( id, file_name, file_url, mime_type, sort_order ), studios:studio_id ( id, slug, name, tagline, bio, cover_image, logo_image, photo_feed_items, instagram, website, primary_location_id ), location:location_id ( id, label, city, country, formatted_address, latitude, longitude )')
                .eq('status', 'open')
                .order('directory_rank', { ascending: true, nullsFirst: false })
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
        // studio-spots-directory.js:265. `requestedDates` es opcional y viaja como
        // literal DATERANGE ('[inicio,fin)') cuando el artista elige fechas.
        createApplication({ spotId, artistUserId, message, portfolioUrl, requestedDates }) {
            const row = { spot_id: spotId, artist_user_id: artistUserId, message, portfolio_url: portfolioUrl };
            if (requestedDates) row.requested_dates = requestedDates;
            return from('studio_spot_applications').insert(row);
        },

        // Acepta/rechaza una postulacion (status + decided_at). Cubre
        // studio-dashboard.js:634.
        decideApplication(applicationId, status) {
            return from('studio_spot_applications').update({ status, decided_at: new Date().toISOString() }).eq('id', applicationId);
        },

        // Postulaciones ENVIADAS por el artista con spot/estudio/sede embebidos.
        // Cubre /artist/applications (rediseño 2026). Si la RLS del spot no lo
        // deja ver (p.ej. cerrado), el embed llega null: la UI degrada.
        listApplicationsByArtist(artistUserId) {
            return from('studio_spot_applications')
                .select('id, status, message, portfolio_url, requested_dates, created_at, decided_at, studio_spots ( id, title, kind, description, styles_wanted, includes_housing, revenue_split_pct, stipend_amount, stipend_currency, stipend_frequency, start_date, end_date, weeks_minimum, weeks_maximum, status, cover_image, studio_includes, artist_expectations, minimum_requirements, contact_name, contact_title, response_sla_label, attachments:studio_spot_attachments ( id, file_name, file_url, mime_type, sort_order ), studios:studio_id ( id, name, slug, logo_image, cover_image, photo_feed_items ), location:location_id ( city, country, label ) )')
                .eq('artist_user_id', artistUserId)
                .order('created_at', { ascending: false });
        },

        // Historial de negociación de una postulación a un Spot.
        listCounterOffers(applicationId) {
            return from('studio_spot_counter_offers')
                .select('id, application_id, author_role, split_pct, proposed_start_date, proposed_end_date, note, status, created_at, decided_at')
                .eq('application_id', applicationId)
                .order('created_at', { ascending: false });
        },

        createCounterOffer({ applicationId, authorRole, revenueSplitPct = null, startDate = null, endDate = null, note = null }) {
            return client().rpc('create_studio_spot_counter_offer', {
                p_application_id: applicationId,
                p_author_role: authorRole,
                p_split_pct: revenueSplitPct,
                p_proposed_start_date: startDate,
                p_proposed_end_date: endDate,
                p_note: note,
            });
        },

        decideCounterOffer(counterOfferId, status) {
            const action = status === 'accepted' || status === 'accept' ? 'accept'
                : status === 'rejected' || status === 'reject' ? 'reject' : null;
            if (!action) throw new Error('StudioSpots.decideCounterOffer: status inválido');
            return client().rpc('respond_to_studio_spot_counter_offer', {
                p_offer_id: counterOfferId,
                p_action: action,
            });
        },

        // Retiro de una postulacion propia (status del enum legacy).
        withdrawApplication(applicationId) {
            return from('studio_spot_applications').update({ status: 'withdrawn', decided_at: new Date().toISOString() }).eq('id', applicationId);
        },

        // --- spots y contratos (M2) ---

        // Decide una postulacion por RPC (dueno o soporte). Con M2, 'accepted'
        // deja la postulacion en shortlisted y prepara el borrador de contrato.
        decideApplicationRpc(appId, status) {
            return rpc('decide_studio_spot_application', { p_application_id: appId, p_status: status });
        },

        // Spots abiertos de un estudio (perfil publico). Pide benefit_tags y,
        // si la columna no existe, reintenta sin ella con benefit_tags=[]
        // (`legacy: true`).
        async listOpenByStudio(studioId) {
            const base = 'id, title, kind, start_date, end_date, application_count';
            const build = (cols) => from('studio_spots')
                .select(cols)
                .eq('studio_id', studioId)
                .eq('status', 'open')
                .order('start_date', { ascending: true, nullsFirst: false })
                .order('id');
            const full = await settle(() => build(`${base}, benefit_tags`));
            if (!full.error || !isMissingColumn(full.error)) return full;
            const legacy = await settle(() => build(base));
            if (legacy.error) return legacy;
            return { ...mapRows(legacy, (row) => ({ ...row, benefit_tags: [] })), legacy: true };
        },

        // Contraofertas pendientes que mandaron artistas a spots del estudio,
        // con la postulacion (studio_spot_applications), su spot (studio_spots)
        // y su artista (artists_db) embebidos. Badge: traga la migracion pendiente.
        listArtistCounterOffersForStudio(studioId) {
            return soft(() => allRows(() => from('studio_spot_counter_offers')
                .select('id, application_id, author_role, split_pct, proposed_start_date, proposed_end_date, note, status, created_at, ' +
                    'studio_spot_applications!inner ( id, status, spot_id, artist_user_id, created_at, ' +
                    'studio_spots!inner ( id, title, kind, studio_id ), ' +
                    'artists_db ( user_id, name, username, profile_picture, styles_array ) )')
                .eq('studio_spot_applications.studio_spots.studio_id', studioId)
                .eq('author_role', 'artist')
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .order('id')), []);
        },

        // Responde una contraoferta con la RPC existente. decision: 'accept' |
        // 'reject' (tambien 'accepted' | 'rejected'). No lanza: un valor
        // invalido lo rechaza la RPC.
        respondCounterOffer(id, decision) {
            const action = decision === 'accepted' ? 'accept' : decision === 'rejected' ? 'reject' : decision;
            return rpc('respond_to_studio_spot_counter_offer', { p_offer_id: id, p_action: action });
        },
    };

    // ===================== StudioOps (jobs, invoices, documents, inventory, suppliers, sponsors, vistas) =====================
    const StudioOps = {
        listTravelLinks(studioId) { return client().rpc('list_studio_travel_links', { p_studio_id: studioId }); },
        listDocumentAttachments(documentId) {
            return from('studio_document_attachments').select('*').eq('document_id', documentId).order('created_at', { ascending: false });
        },
        createDocumentAttachment(payload) { return from('studio_document_attachments').insert(payload).select().single(); },
        deleteDocumentAttachment(id) { return from('studio_document_attachments').delete().eq('id', id); },
        listBookings(studioId, start, end) {
            return allRows(() => {
                let query = from('studio_bookings').select('*, artists_db(name,username), studio_locations(label)')
                    .eq('studio_id', studioId).order('starts_at').order('id');
                if (start) query = query.gte('starts_at', start);
                if (end) query = query.lt('starts_at', end);
                return query;
            });
        },
        saveBooking(id, payload) {
            return id ? from('studio_bookings').update(payload).eq('id', id).select().single()
                : from('studio_bookings').insert(payload).select().single();
        },
        completeBooking(id) { return client().rpc('complete_studio_booking', { p_booking_id: id }); },
        saveInvoice(id, header, items) {
            return client().rpc('save_studio_invoice', { p_invoice_id: id || null, p_header: header, p_items: items });
        },
        replaceSponsorArtists(id, artistIds) {
            return client().rpc('replace_studio_sponsor_artists', { p_sponsor_id: id, p_artist_ids: artistIds });
        },
        // Historial del item. Suma unit_cost y related_artist_user_id (existen en
        // vivo); el nombre del artista se resuelve en el cliente con el roster.
        listInventoryMovements(itemId) {
            return from('studio_inventory_movements').select('id,kind,quantity,performed_at,notes,unit_cost,related_artist_user_id')
                .eq('item_id', itemId).order('performed_at', { ascending: false }).limit(100);
        },

        // ---- agenda (M3) ----

        // Citas del estudio que se superponen con [fromIso, toIso): empiezan
        // antes del fin del rango y terminan despues de su inicio. Mismo embed
        // que listBookings; las columnas de M3 llegan por '*'.
        listBookingsRange(studioId, fromIso, toIso) {
            return settle(() => allRows(() => {
                let query = from('studio_bookings').select('*, artists_db(name,username), studio_locations(label)')
                    .eq('studio_id', studioId).order('starts_at').order('id');
                if (toIso) query = query.lt('starts_at', toIso);
                if (fromIso) query = query.gt('ends_at', fromIso);
                return query;
            }));
        },

        // Chequeo de disponibilidad del artista (agenda personal, sesiones de
        // cotizacion, otros estudios). Devuelve { available, reason }.
        checkBookingAvailability(studioId, artistUserId, startsIso, endsIso, excludeId) {
            return rpc('check_studio_booking_availability', {
                p_studio_id: studioId,
                p_artist_user_id: artistUserId,
                p_starts: startsIso,
                p_ends: endsIso,
                p_exclude_booking: excludeId || null,
            });
        },

        // Bloques "Ocupado" (sin detalle) de los artistas activos del estudio;
        // rango de 62 dias o menos. Paginado con orden estable (la RPC no
        // devuelve id). Sin la migracion: [] + `unavailable`.
        listArtistBusyBlocks(studioId, fromIso, toIso) {
            return soft(() => allRows(() => client()
                .rpc('list_studio_artist_busy_blocks', { p_studio_id: studioId, p_from: fromIso, p_to: toIso })
                .order('artist_user_id').order('starts_at').order('ends_at').order('source')), []);
        },

        // Citas del artista en estudios (proyeccion de su calendario), con
        // studios(name, slug). Mismo criterio de superposicion que
        // listBookingsRange; todos los estados (el llamador filtra confirmed).
        listBookingsForArtist(artistUserId, fromIso, toIso) {
            return soft(() => allRows(() => {
                let query = from('studio_bookings')
                    .select('id, studio_id, location_id, artist_user_id, client_name, starts_at, ends_at, status, studios(name, slug)')
                    .eq('artist_user_id', artistUserId).order('starts_at').order('id');
                if (toIso) query = query.lt('starts_at', toIso);
                if (fromIso) query = query.gt('ends_at', fromIso);
                return query;
            }), []);
        },

        // ---- materiales entregados a artistas (M3) ----

        // Balance por artista e item (vista studio_artist_material_balance).
        listMaterialBalance(studioId) {
            return soft(() => allRows(() => from('studio_artist_material_balance')
                .select('*')
                .eq('studio_id', studioId)
                .order('artist_user_id').order('item_id')), []);
        },

        // Entregas netas de devoluciones por mes, artista y moneda (vista
        // studio_material_assignment_monthly). from/to: 'YYYY-MM-DD'.
        listMaterialAssignmentsMonthly(studioId, fromDate, toDate) {
            return soft(() => allRows(() => {
                let query = from('studio_material_assignment_monthly').select('*').eq('studio_id', studioId);
                if (fromDate) query = query.gte('month', monthStart(fromDate));
                if (toDate) query = query.lte('month', toDate);
                return query.order('month').order('artist_user_id').order('currency');
            }), []);
        },

        // Entregas y devoluciones de materiales al artista autenticado.
        listMyMaterialAssignments() {
            return soft(() => allRows(() => client()
                .rpc('list_my_studio_material_assignments')
                .order('performed_at', { ascending: false }).order('studio_id').order('item_name').order('kind')), []);
        },

        // ---- tienda ----
        // Venta de mostrador (create_store_pos_order, M6): un ítem por pedido,
        // cobrado por el estudio; idempotente por idempotencyKey.
        createStorePosOrder({ studioId, productId, variantId, quantity, paymentMethod, buyerName, buyerEmail, buyerPhone, idempotencyKey } = {}) {
            return rpc('create_store_pos_order', {
                p_studio_id: studioId,
                p_product_id: productId,
                p_variant_id: variantId || null,
                p_quantity: quantity || 1,
                p_payment_method: paymentMethod,
                p_buyer_name: buyerName || null,
                p_buyer_email: buyerEmail || null,
                p_buyer_phone: buyerPhone || null,
                p_idempotency_key: idempotencyKey || null,
            });
        },

        // ---- reportes ----

        // Metricas mensuales por moneda entre dos fechas ('YYYY-MM-DD'; el
        // inicio se lleva al dia 1 de su mes porque la vista guarda month=dia 1).
        listMonthlyMetrics(studioId, fromDate, toDate) {
            return settle(() => allRows(() => {
                let query = from('studio_monthly_metrics_by_currency').select('*').eq('studio_id', studioId);
                if (fromDate) query = query.gte('month', monthStart(fromDate));
                if (toDate) query = query.lte('month', toDate);
                return query.order('month').order('currency');
            }));
        },

        // ---- reposicion (M5) ----

        // Items activos (columnas de listInventoryItems) + supply_product_id y
        // el producto Supplies vinculado. Sin M5 reintenta sin el embed y
        // completa supply_product_id/supply_products en null (`legacy: true`).
        // El filtro "por debajo del punto de reposicion" lo hace el llamador.
        async listRestockCandidates(studioId) {
            const base = 'id, name, sku, category, unit, quantity_on_hand, reorder_level, cost_per_unit, currency, supplier_id, studio_suppliers ( name )';
            const build = (cols) => () => from('studio_inventory_items')
                .select(cols)
                .eq('studio_id', studioId)
                .eq('is_active', true)
                .order('name', { ascending: true }).order('id');
            const full = await settle(() => allRows(build(`${base}, supply_product_id, supply_products!supply_product_id ( id, name, price, currency, vendor_id, unit_label, pack_size )`)));
            if (!full.error || !isMissingColumn(full.error)) return full;
            const legacy = await settle(() => allRows(build(base)));
            if (legacy.error) return legacy;
            return { ...mapRows(legacy, (row) => ({ ...row, supply_product_id: null, supply_products: null })), legacy: true };
        },
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
        async listJobsForClientAggregation(studioId) {
            const rows = [];
            for (let offset = 0; ; offset += 500) {
                const result = await from('studio_jobs_log')
                    .select('id, client_user_id, client_display_name, client_email, gross_amount, gross_currency, performed_at')
                    .eq('studio_id', studioId).eq('status', 'completed').order('id').range(offset, offset + 499);
                if (result.error) return result;
                rows.push(...(result.data || []));
                if ((result.data || []).length < 500) return { data: rows, error: null };
            }
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
            return allRows(() => from('studio_invoices').select('*').eq('studio_id', studioId).order('issue_date', { ascending: false }).order('id'));
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
            return from('studio_invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', id).in('status', ['draft', 'sent', 'overdue']).select().single();
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
            return allRows(() => from('studio_documents').select('*').eq('studio_id', studioId).order('created_at', { ascending: false }).order('id'));
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
            return allRows(() => from('studio_inventory_items')
                .select('id, name, sku, category, unit, quantity_on_hand, reorder_level, cost_per_unit, currency, supplier_id, studio_suppliers ( name )')
                .eq('studio_id', studioId)
                .eq('is_active', true)
                .order('name', { ascending: true }).order('id'));
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
            return from('studio_inventory_items').update({ is_active: false }).eq('id', id).select().single();
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
            return allRows(() => from('studio_inventory_health_by_currency')
                .select('id, name, quantity_on_hand, reorder_level, needs_reorder, stock_value, currency')
                .eq('studio_id', studioId)
                .order('needs_reorder', { ascending: false }).order('id'));
        },

        // ---- studio_suppliers ----

        // Proveedores del estudio ordenados por nombre. Cubre studio-dashboard-ops.js:719.
        listSuppliers(studioId) {
            return allRows(() => from('studio_suppliers').select('*').eq('studio_id', studioId).order('name').order('id'));
        },

        // Opciones de proveedor (id, name) para selectores. Cubre studio-dashboard-ops.js:604.
        listSupplierOptions(studioId) {
            return allRows(() => from('studio_suppliers').select('id,name').eq('studio_id', studioId).order('name').order('id'));
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
            return allRows(() => from('studio_sponsors').select('*').eq('studio_id', studioId).order('tier', { ascending: false }).order('id'));
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
            const since = new Date();
            since.setUTCDate(1);
            since.setUTCMonth(since.getUTCMonth() - (months - 1));
            return from('studio_monthly_metrics_by_currency')
                .select('*')
                .eq('studio_id', studioId)
                .gte('month', since.toISOString().slice(0, 10))
                .order('month', { ascending: false });
        },

        // Rendimiento por artista (top N por bruto facturado). Cubre studio-dashboard-ops.js:983.
        getArtistPerformance(studioId, { limit = 20 } = {}) {
            return from('studio_artist_metrics_by_currency')
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
