-- Figma final del flujo de artista (oct 2026) · Recordatorios del dashboard.
-- Frames 801:563 (ver detalle), 801:560 (nuevo) y 801:1109 (editar detalle y
-- prioridad). Hasta ahora los recordatorios vivían como texto suelto en
-- user_preferences.app_settings.reminders ([{ text, type, done }]), sin fecha,
-- prioridad, detalle ni adjuntos. Esta migración crea la tabla propia, el
-- bucket privado para adjuntos y copia los recordatorios existentes.
--
-- Aditiva e idempotente. Reversa: supabase/rollbacks/20261028110000_artist_reminders.down.sql

create table if not exists public.artist_reminders (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 140),
  detail text check (detail is null or char_length(detail) <= 2000),
  icon text not null default 'bell' check (icon in (
    'droplet', 'edit', 'message-circle', 'dollar-sign', 'calendar', 'clock',
    'star', 'alert-triangle', 'bell', 'check-circle', 'image', 'pen-tool',
    'users', 'briefcase', 'map-pin', 'send', 'zap', 'heart'
  )),
  due_date date,
  priority text not null default 'normal'
    check (priority in ('urgente', 'alta', 'normal', 'baja')),
  is_important boolean not null default true,
  -- [{ name, path, size, mime }] · path dentro del bucket artist-reminder-files
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_artist_reminders_artist_open
  on public.artist_reminders (artist_user_id, completed_at, due_date);

create or replace function public.artist_reminders_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_artist_reminders_updated_at on public.artist_reminders;
create trigger trg_artist_reminders_updated_at
  before update on public.artist_reminders
  for each row execute function public.artist_reminders_touch_updated_at();

alter table public.artist_reminders enable row level security;

drop policy if exists artist_reminders_owner_select on public.artist_reminders;
create policy artist_reminders_owner_select on public.artist_reminders
  for select to authenticated
  using ((select auth.uid()) = artist_user_id);

drop policy if exists artist_reminders_owner_insert on public.artist_reminders;
create policy artist_reminders_owner_insert on public.artist_reminders
  for insert to authenticated
  with check ((select auth.uid()) = artist_user_id);

drop policy if exists artist_reminders_owner_update on public.artist_reminders;
create policy artist_reminders_owner_update on public.artist_reminders
  for update to authenticated
  using ((select auth.uid()) = artist_user_id)
  with check ((select auth.uid()) = artist_user_id);

drop policy if exists artist_reminders_owner_delete on public.artist_reminders;
create policy artist_reminders_owner_delete on public.artist_reminders
  for delete to authenticated
  using ((select auth.uid()) = artist_user_id);

-- Solo el CRUD que usa la UI, nada para anon.
revoke all on table public.artist_reminders from public, anon, authenticated;
grant select, insert, update, delete on table public.artist_reminders to authenticated;

-- Adjuntos: bucket privado, carpeta raíz = uid del artista.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artist-reminder-files',
  'artist-reminder-files',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "artist_reminder_files_owner_select" on storage.objects;
create policy "artist_reminder_files_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'artist-reminder-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "artist_reminder_files_owner_insert" on storage.objects;
create policy "artist_reminder_files_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'artist-reminder-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "artist_reminder_files_owner_delete" on storage.objects;
create policy "artist_reminder_files_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'artist-reminder-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Copia de los recordatorios guardados en user_preferences (formato legacy
-- { text, type, done } o el formato completo que usa el repo como respaldo
-- mientras esta tabla no existe). Solo para usuarios sin filas todavía.
insert into public.artist_reminders
  (artist_user_id, title, detail, icon, due_date, priority, is_important, completed_at, created_at)
select
  up.user_id,
  left(btrim(coalesce(nullif(r.item->>'title', ''), r.item->>'text')), 140),
  nullif(r.item->>'detail', ''),
  case
    when r.item->>'icon' in (
      'droplet', 'edit', 'message-circle', 'dollar-sign', 'calendar', 'clock',
      'star', 'alert-triangle', 'bell', 'check-circle', 'image', 'pen-tool',
      'users', 'briefcase', 'map-pin', 'send', 'zap', 'heart'
    ) then r.item->>'icon'
    when r.item->>'type' = 'stock' then 'droplet'
    when r.item->>'type' = 'sketch' then 'edit'
    when r.item->>'type' = 'message' then 'message-circle'
    when r.item->>'type' = 'payment' then 'dollar-sign'
    when r.item->>'type' = 'session' then 'calendar'
    when r.item->>'type' = 'travel' then 'map-pin'
    else 'bell'
  end,
  case when (r.item->>'due_date') ~ '^\d{4}-\d{2}-\d{2}$' then (r.item->>'due_date')::date end,
  case when r.item->>'priority' in ('urgente', 'alta', 'normal', 'baja') then r.item->>'priority' else 'normal' end,
  coalesce((r.item->>'is_important')::boolean, true),
  case
    when (r.item->>'completed_at') is not null then (r.item->>'completed_at')::timestamptz
    when coalesce((r.item->>'done')::boolean, false) then now()
  end,
  now()
from public.user_preferences up
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(up.app_settings->'reminders') = 'array'
       then up.app_settings->'reminders' else '[]'::jsonb end
) as r(item)
where jsonb_typeof(r.item) = 'object'
  and char_length(btrim(coalesce(nullif(r.item->>'title', ''), r.item->>'text', ''))) > 0
  and exists (select 1 from auth.users u where u.id = up.user_id)
  and not exists (
    select 1 from public.artist_reminders ar where ar.artist_user_id = up.user_id
  );
