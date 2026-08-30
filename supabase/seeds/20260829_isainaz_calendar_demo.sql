-- Demo idempotente del Calendario Figma para isainazartattoo.wo.
-- Marcador de alcance: [PRUEBA][CALENDAR-ISAINAZ-20260829]
-- Requiere 20260829145232_artist_calendar_events.sql.

begin;

with target as (
  select user_id
  from public.artists_db
  where lower(username) = 'isainazartattoo.wo'
  limit 1
), demo(
  id, event_type, title, client_name, starts_at, ends_at, all_day,
  location, notes, status, recurrence_rule, recurrence_until
) as (values
  (
    'ca1e2608-0001-4000-8000-000000000001'::uuid,
    'confirmed_session', 'Sesión — Laura Pérez', 'Laura Pérez',
    '2026-07-01 10:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-01 12:00 America/Argentina/Buenos_Aires'::timestamptz,
    false, 'Estudio propio', '[PRUEBA][CALENDAR-ISAINAZ-20260829] Manga floral',
    'scheduled', 'none', null::date
  ),
  (
    'ca1e2608-0002-4000-8000-000000000002'::uuid,
    'availability', 'Agenda abierta', null,
    '2026-07-02 09:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-02 18:00 America/Argentina/Buenos_Aires'::timestamptz,
    false, 'Estudio propio', '[PRUEBA][CALENDAR-ISAINAZ-20260829] Cupos disponibles',
    'scheduled', 'none', null
  ),
  (
    'ca1e2608-0003-4000-8000-000000000003'::uuid,
    'blocked_day', 'Administración', null,
    '2026-07-06 00:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-07 00:00 America/Argentina/Buenos_Aires'::timestamptz,
    true, null, '[PRUEBA][CALENDAR-ISAINAZ-20260829] Día sin turnos',
    'scheduled', 'none', null
  ),
  (
    'ca1e2608-0004-4000-8000-000000000004'::uuid,
    'confirmed_session', 'Sesión — Tomás Reyes', 'Tomás Reyes',
    '2026-07-07 11:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-07 14:00 America/Argentina/Buenos_Aires'::timestamptz,
    false, 'Estudio propio', '[PRUEBA][CALENDAR-ISAINAZ-20260829] Sesión de líneas',
    'scheduled', 'none', null
  ),
  (
    'ca1e2608-0005-4000-8000-000000000005'::uuid,
    'pending_request', 'Bruno Aquino — mandala', 'Bruno Aquino',
    '2026-07-08 15:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-08 17:00 America/Argentina/Buenos_Aires'::timestamptz,
    false, 'Estudio propio', '[PRUEBA][CALENDAR-ISAINAZ-20260829] Esperando respuesta',
    'pending', 'none', null
  ),
  (
    'ca1e2608-0006-4000-8000-000000000006'::uuid,
    'reservation', 'Julieta Sosa — seña confirmada', 'Julieta Sosa',
    '2026-07-09 10:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-09 12:00 America/Argentina/Buenos_Aires'::timestamptz,
    false, 'Estudio propio', '[PRUEBA][CALENDAR-ISAINAZ-20260829] Seña confirmada',
    'scheduled', 'none', null
  ),
  (
    'ca1e2608-0007-4000-8000-000000000007'::uuid,
    'convention', 'Feria Tinta Buenos Aires', null,
    '2026-07-10 00:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-11 00:00 America/Argentina/Buenos_Aires'::timestamptz,
    true, 'Buenos Aires', '[PRUEBA][CALENDAR-ISAINAZ-20260829] Convención anual',
    'scheduled', 'none', null
  ),
  (
    'ca1e2608-0008-4000-8000-000000000008'::uuid,
    'guest_spot', 'Guest en Fierro Negro Tattoo', null,
    '2026-07-13 00:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-14 00:00 America/Argentina/Buenos_Aires'::timestamptz,
    true, 'Fierro Negro Tattoo', '[PRUEBA][CALENDAR-ISAINAZ-20260829] Jornada invitada',
    'scheduled', 'none', null
  ),
  (
    'ca1e2608-0009-4000-8000-000000000009'::uuid,
    'confirmed_session', 'Sesión — Camila Ortiz', 'Camila Ortiz',
    '2026-07-14 12:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-14 15:00 America/Argentina/Buenos_Aires'::timestamptz,
    false, 'Estudio propio', '[PRUEBA][CALENDAR-ISAINAZ-20260829] Blackwork',
    'scheduled', 'none', null
  ),
  (
    'ca1e2608-0010-4000-8000-000000000010'::uuid,
    'personal', 'Reunión de portfolio', null,
    '2026-07-15 18:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-15 19:00 America/Argentina/Buenos_Aires'::timestamptz,
    false, null, '[PRUEBA][CALENDAR-ISAINAZ-20260829] Selección de trabajos',
    'scheduled', 'none', null
  ),
  (
    'ca1e2608-0011-4000-8000-000000000011'::uuid,
    'reminder', 'Confirmar insumos', null,
    '2026-07-16 08:30 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-16 09:00 America/Argentina/Buenos_Aires'::timestamptz,
    false, null, '[PRUEBA][CALENDAR-ISAINAZ-20260829] Recordatorio semanal',
    'scheduled', 'weekly', date '2026-07-30'
  ),
  (
    'ca1e2608-0012-4000-8000-000000000012'::uuid,
    'availability', 'Cupos de tarde', null,
    '2026-07-17 14:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-17 18:00 America/Argentina/Buenos_Aires'::timestamptz,
    false, 'Estudio propio', '[PRUEBA][CALENDAR-ISAINAZ-20260829] Disponible',
    'scheduled', 'none', null
  ),
  (
    'ca1e2608-0013-4000-8000-000000000013'::uuid,
    'confirmed_session', 'Sesión — Martín Luna', 'Martín Luna',
    '2026-07-23 12:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-23 14:00 America/Argentina/Buenos_Aires'::timestamptz,
    false, 'Estudio propio', '[PRUEBA][CALENDAR-ISAINAZ-20260829] Retoque',
    'scheduled', 'none', null
  ),
  (
    'ca1e2608-0014-4000-8000-000000000014'::uuid,
    'blocked_day', 'Mantenimiento del estudio', null,
    '2026-07-24 00:00 America/Argentina/Buenos_Aires'::timestamptz,
    '2026-07-25 00:00 America/Argentina/Buenos_Aires'::timestamptz,
    true, null, '[PRUEBA][CALENDAR-ISAINAZ-20260829] Día bloqueado',
    'scheduled', 'none', null
  )
)
insert into public.artist_calendar_events (
  id, artist_user_id, event_type, title, client_name, starts_at, ends_at,
  all_day, location, notes, status, recurrence_rule, recurrence_until
)
select
  d.id, t.user_id, d.event_type, d.title, d.client_name, d.starts_at, d.ends_at,
  d.all_day, d.location, d.notes, d.status, d.recurrence_rule, d.recurrence_until
from demo d
cross join target t
on conflict (id) do update set
  event_type = excluded.event_type,
  title = excluded.title,
  client_name = excluded.client_name,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  all_day = excluded.all_day,
  location = excluded.location,
  notes = excluded.notes,
  status = excluded.status,
  recurrence_rule = excluded.recurrence_rule,
  recurrence_until = excluded.recurrence_until,
  updated_at = now();

commit;

-- Rollback acotado:
-- delete from public.artist_calendar_events
-- where notes like '%[PRUEBA][CALENDAR-ISAINAZ-20260829]%';
