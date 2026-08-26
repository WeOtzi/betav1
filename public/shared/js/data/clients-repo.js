/**
 * WE OTZI - Repositorios del dominio Clientes (frontend)
 * ------------------------------------------------------
 * Metodos con nombre sobre la capa PostgREST unificada (postgrest-client.js).
 * Reemplazan los `WeotziData.from('clients_db' | 'client_public_profiles')`
 * dispersos por los modulos de cliente (auth, dashboard, perfil publico, job
 * board, reviews, logging).
 *
 * Al igual que artists-repo.js, estos metodos son WRAPPERS FINOS que DEVUELVEN
 * el builder de supabase-js sin resolver: el llamador sigue recibiendo
 * `{ data, error }` y conserva su propio manejo de error. No usan `run` ni
 * lanzan. Asi la migracion de los call sites es mecanica (reemplazar
 * `WeotziData.from('clients_db').select(...).eq(...)` por
 * `WeotziData.Clients.<metodo>(...)`).
 *
 * Las columnas FIJAS de proyecciones con nombre propio (contacto para logging,
 * reviewer para reviews) quedan ENCAPSULADAS aqui para que ningun llamador las
 * repita. Para reads genericos con columnas variables se acepta `columns='*'`
 * como parametro.
 *
 * Carga: DESPUES de postgrest-client.js. Expone
 * window.WeotziData.{Clients, ClientProfiles}.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.from !== 'function') {
        console.error('[clients-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const from = D.from;

    // Proyeccion de contacto del cliente (enriquecimiento de logging).
    const CONTACT_SELECT = 'email, whatsapp';

    // Proyeccion del reviewer (tarjeta de resena del cliente).
    const REVIEWER_SELECT =
        'user_id,email,full_name,public_username,country,city_residence,profile_picture,profile_completed_at';

    // ===================== clients_db =====================
    const Clients = {
        // --- reads por user_id ---

        // Registro del cliente por user_id. columns variable; .maybeSingle().
        // Cubre client-auth.js:44, :411, :668, :732, :751, :771,
        // client-dashboard.js:111, job-board-request.js:809, :1035,
        // artist-login.js:119 (columns='user_id').
        getByUserId(userId, columns = '*') {
            return from('clients_db').select(columns).eq('user_id', userId).maybeSingle();
        },

        // email + whatsapp del cliente (enriquecimiento de logging). columns
        // FIJAS (CONTACT_SELECT). .maybeSingle(). Cubre logging-service.js:193.
        getContactByUserId(userId) {
            return from('clients_db').select(CONTACT_SELECT).eq('user_id', userId).maybeSingle();
        },

        // Perfil del reviewer (cliente) para la tarjeta de resena. columns FIJAS
        // (REVIEWER_SELECT). .maybeSingle(). Cubre reviews.js:354.
        getReviewerByUserId(userId) {
            return from('clients_db').select(REVIEWER_SELECT).eq('user_id', userId).maybeSingle();
        },

        // --- inserts ---

        // Inserta un registro de cliente (payload variable: alta por email/OAuth).
        // Cubre client-auth.js:228, :445, :685, :764, client-dashboard.js:128,
        // job-board-request.js:945, :1043.
        insert(row) {
            return from('clients_db').insert(row);
        },

        // --- updates ---

        // Patch del cliente por user_id (guardado de perfil del dashboard).
        // Cubre client-dashboard.js:1340.
        updateByUserId(userId, patch) {
            return from('clients_db').update(patch).eq('user_id', userId);
        },
    };

    // ===================== client_public_profiles / client_profiles =========
    const ClientProfiles = {
        // Vista del perfil publico del cliente; devuelve el builder con select ya
        // aplicado para que el caller encadene el filtro (eq user_id vs
        // public_username) y .maybeSingle(). columns variable. Cubre
        // client-profile.js:40.
        select(columns = '*') {
            return from('client_public_profiles').select(columns);
        },

        // --- tabla client_profiles (satelite del wizard de /client/register,
        //     migracion 20260825160000_reaudit_satellites.sql; RLS owner) ---
        // OJO: distinta de la vista client_public_profiles del metodo select().

        // Perfil del wizard por auth user. .maybeSingle().
        getByUserId(clientUserId, columns = '*') {
            return from('client_profiles').select(columns).eq('client_user_id', clientUserId).maybeSingle();
        },

        // Upsert del perfil del wizard (username UNIQUE: un duplicado devuelve
        // error 23505 en { error } — el caller decide como mostrarlo).
        upsert(row) {
            return from('client_profiles')
                .upsert(row, { onConflict: 'client_user_id' })
                .select()
                .maybeSingle();
        },
    };

    D.Clients = Clients;
    D.ClientProfiles = ClientProfiles;
})();
