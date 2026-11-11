'use strict';

// Catálogo de tablas con FK hacia artists_db y qué le pasa a cada una al
// borrar el artista. Refleja las constraints vivas (consultadas en
// pg_constraint, 2026-11-10). `ref` indica qué columna de artists_db
// referencia la FK; `effect` es lo que hace el borrado forzado:
//   - 'cascade'  → Postgres las borra solo (ON DELETE CASCADE)
//   - 'set_null' → Postgres pone la columna en NULL (ON DELETE SET NULL)
//   - 'unlink'   → la FK bloquea (NO ACTION) pero la columna es nullable:
//                  el servidor la pone en NULL antes de borrar
//   - 'purge'    → la FK bloquea y la columna es NOT NULL: el servidor
//                  borra esas filas antes de borrar al artista
const ARTIST_RELATIONS = [
    { table: 'quotations_db', column: 'artist_id', ref: 'user_id', effect: 'set_null', label: 'Cotizaciones' },
    { table: 'job_board_requests', column: 'accepted_artist_id', ref: 'user_id', effect: 'unlink', label: 'Solicitudes de la bolsa de trabajo aceptadas' },
    { table: 'studio_bookings', column: 'artist_user_id', ref: 'user_id', effect: 'purge', label: 'Reservas en estudios' },
    { table: 'studio_jobs_log', column: 'artist_user_id', ref: 'user_id', effect: 'purge', label: 'Registro de trabajos en estudios' },
    { table: 'studio_contracts', column: 'artist_user_id', ref: 'user_id', effect: 'set_null', label: 'Contratos con estudios' },
    { table: 'job_board_applications', column: 'artist_id', ref: 'user_id', effect: 'cascade', label: 'Postulaciones a la bolsa de trabajo' },
    { table: 'artist_tattoo_locations', column: 'artist_user_id', ref: 'user_id', effect: 'cascade', label: 'Ubicaciones de trabajo' },
    { table: 'verification_history', column: 'artist_id', ref: 'id', effect: 'cascade', label: 'Historial de verificación' },
    { table: 'artist_profile_visits', column: 'artist_id', ref: 'user_id', effect: 'cascade', label: 'Visitas al perfil' },
    { table: 'artist_profile_visits_daily_legacy', column: 'artist_id', ref: 'user_id', effect: 'cascade', label: 'Visitas al perfil (histórico)' },
    { table: 'studio_artist_memberships', column: 'artist_user_id', ref: 'user_id', effect: 'cascade', label: 'Membresías en estudios' },
    { table: 'studio_spot_applications', column: 'artist_user_id', ref: 'user_id', effect: 'cascade', label: 'Postulaciones a spots de estudios' },
    { table: 'studio_sponsor_artists', column: 'artist_user_id', ref: 'user_id', effect: 'cascade', label: 'Patrocinios de estudios' },
    { table: 'studio_invitation_change_requests', column: 'artist_user_id', ref: 'user_id', effect: 'cascade', label: 'Solicitudes de cambio de invitación' },
    { table: 'artist_saved_job_requests', column: 'artist_user_id', ref: 'user_id', effect: 'cascade', label: 'Solicitudes guardadas' },
    { table: 'artist_travel_passport_stamps', column: 'artist_user_id', ref: 'user_id', effect: 'cascade', label: 'Sellos del pasaporte de viaje' }
];

const EFFECT_TEXT = {
    cascade: 'se eliminarán',
    set_null: 'quedarán sin artista asignado',
    unlink: 'quedarán sin artista asignado',
    purge: 'se eliminarán'
};

// Relaciones que impiden el DELETE directo y requieren limpieza previa.
function isBlocking(rel) {
    return rel.effect === 'unlink' || rel.effect === 'purge';
}

/**
 * Cuenta las filas relacionadas. `pgrest` se inyecta para poder testear.
 * Devuelve solo las relaciones con count > 0.
 */
async function countArtistRelations(pgrest, artist) {
    const out = [];
    for (const rel of ARTIST_RELATIONS) {
        const key = artist[rel.ref];
        if (!key) continue;
        const { count } = await pgrest(rel.table)
            .select(rel.column)
            .eq(rel.column, key)
            .limit(1)
            .count('exact')
            .execute();
        if (count > 0) {
            out.push({
                table: rel.table,
                label: rel.label,
                count,
                effect: rel.effect,
                effectText: EFFECT_TEXT[rel.effect],
                blocking: isBlocking(rel)
            });
        }
    }
    return out;
}

/**
 * Desbloquea el borrado: desvincula o elimina las filas cuya FK no tiene
 * acción ON DELETE. El resto lo resuelve Postgres al borrar el artista.
 */
async function clearBlockingRelations(pgrest, artist) {
    for (const rel of ARTIST_RELATIONS) {
        if (!isBlocking(rel)) continue;
        const key = artist[rel.ref];
        if (!key) continue;
        if (rel.effect === 'unlink') {
            await pgrest(rel.table).eq(rel.column, key).patch({ [rel.column]: null }, { returning: false });
        } else {
            await pgrest(rel.table).eq(rel.column, key).delete();
        }
    }
}

module.exports = { ARTIST_RELATIONS, countArtistRelations, clearBlockingRelations, isBlocking };
