-- ===========================================================================
-- Corrección de datos (beta cerrada · frente roster, ROSTER-12)
-- ---------------------------------------------------------------------------
-- El registro de tatuadores insertaba la membresía con service_role y sin
-- initiated_by, así que el default ('studio') las dejó como si el estudio las
-- hubiera iniciado. Esas filas se reconocen porque son de rol residente y no
-- tienen invited_at ni invited_by_user_id (toda invitación del estudio y toda
-- solicitud por RPC los completan).
--
-- Corre como postgres: el guard de escritura de studio_artist_memberships no
-- aplica y el trigger del inbox no se dispara (no cambia el estado). Solo se
-- toca initiated_by; el estado y las fechas quedan como están.
--
-- Idempotente. Reversa:
--   supabase/rollbacks/20261115230500_backfill_membership_initiated_by.down.sql
-- ===========================================================================

BEGIN;

UPDATE public.studio_artist_memberships m
   SET initiated_by = 'artist'
 WHERE m.initiated_by = 'studio'
   AND m.role = 'resident'
   AND m.invited_at IS NULL
   AND m.invited_by_user_id IS NULL;

COMMIT;
