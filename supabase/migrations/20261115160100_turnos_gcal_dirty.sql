-- Turnos · los apartados marcan la agenda de Google como pendiente (beta cerrada, 15 nov 2026).
--
-- RLS-GCAL-HOLDS-01: 20261115150000 solo engancha trg_gcal_dirty en
-- public.artist_booking_holds si la tabla ya existe, y la crea 20261115160000,
-- que corre después. Sin el trigger, un apartado que vence
-- (public.expire_artist_slot_holds, job cada 15 min) seguía en Google como
-- "Solicitud de turno" hasta el sync completo siguiente (hasta ~30 min).
-- El alta, la confirmación y la liberación ya marcaban por otros caminos
-- (quotations_db, quotation_sessions, requestGcalSync); esto cubre todo.
--
-- Corre como dueño de la migración: el revoke de gcal_attach_dirty_trigger
-- (150000) solo alcanza a public/anon/authenticated.
-- google_event_id no está en artist_booking_holds, así que no hay bucle con
-- la propia sincronización.
--
-- Idempotente (gcal_attach_dirty_trigger rehace el trigger).
-- Reversa: supabase/rollbacks/20261115160100_turnos_gcal_dirty.down.sql

begin;

select private.gcal_attach_dirty_trigger('public.artist_booking_holds', 'artist_user_id', 'direct',
  array['artist_user_id', 'quotation_id', 'starts_at', 'ends_at', 'status', 'expires_at']);

commit;
