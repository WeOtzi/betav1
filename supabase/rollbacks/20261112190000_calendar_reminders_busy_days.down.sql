-- Reversa de 20261112190000_calendar_reminders_busy_days.sql
-- Nota: los recordatorios que la migración movió de artist_calendar_events a
-- artist_reminders quedan en artist_reminders (no se pierden). Las columnas
-- nuevas se eliminan, así que se pierde la hora/repetición de esos recordatorios
-- (queda due_date). El calendario vuelve a guardar recordatorios nuevos en
-- artist_calendar_events automáticamente (calendar-repo detecta la columna).
drop function if exists public.list_artist_public_busy_days(uuid, date, date);
drop function if exists public.claim_due_artist_reminders(integer, integer);
drop trigger if exists trg_artist_reminders_reset_notice on public.artist_reminders;
drop function if exists public.artist_reminders_reset_notice();
drop index if exists public.artist_reminders_due_at_open_idx;
alter table public.artist_reminders drop constraint if exists artist_reminders_recurrence_rule_check;
alter table public.artist_reminders
  drop column if exists last_notified_at,
  drop column if exists recurrence_until,
  drop column if exists recurrence_rule,
  drop column if exists due_at;
drop function if exists private.wo_artist_timezone(uuid);
