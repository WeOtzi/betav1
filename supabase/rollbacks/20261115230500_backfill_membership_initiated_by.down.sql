-- Reversa de 20261115230500_backfill_membership_initiated_by.sql. Vuelve a
-- 'studio' las filas que la corrección marcó como iniciadas por el artista.
-- Las solicitudes nuevas (registro, RPC o enlace) siempre llevan invited_at,
-- así que este criterio no las toca.

begin;

update public.studio_artist_memberships m
   set initiated_by = 'studio'
 where m.initiated_by = 'artist'
   and m.role = 'resident'
   and m.invited_at is null
   and m.invited_by_user_id is null;

commit;
