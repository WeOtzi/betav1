-- Reversa de supabase/migrations/20261028110000_artist_reminders.sql
-- Antes de borrar, devuelve los recordatorios a user_preferences.app_settings.reminders
-- en el formato completo que el repo (reminders-repo.js) usa como respaldo, para
-- que el dashboard siga mostrándolos. Los adjuntos quedan en el bucket hasta que
-- se vacíe a mano (Storage no permite borrar un bucket con objetos).

do $$
begin
  if to_regclass('public.artist_reminders') is not null then
    insert into public.user_preferences (user_id, app_settings)
    select r.artist_user_id,
           jsonb_build_object('reminders', jsonb_agg(jsonb_build_object(
             'id', r.id,
             'title', r.title,
             'text', r.title,
             'detail', r.detail,
             'icon', r.icon,
             'due_date', r.due_date,
             'priority', r.priority,
             'is_important', r.is_important,
             'completed_at', r.completed_at,
             'done', r.completed_at is not null,
             'created_at', r.created_at
           ) order by r.created_at))
    from public.artist_reminders r
    group by r.artist_user_id
    on conflict (user_id) do update
      set app_settings = coalesce(public.user_preferences.app_settings, '{}'::jsonb)
                         || jsonb_build_object('reminders', excluded.app_settings->'reminders');
  end if;
end;
$$;

drop policy if exists "artist_reminder_files_owner_select" on storage.objects;
drop policy if exists "artist_reminder_files_owner_insert" on storage.objects;
drop policy if exists "artist_reminder_files_owner_delete" on storage.objects;
delete from storage.buckets
 where id = 'artist-reminder-files'
   and not exists (select 1 from storage.objects o where o.bucket_id = 'artist-reminder-files');

drop trigger if exists trg_artist_reminders_updated_at on public.artist_reminders;
drop table if exists public.artist_reminders;
drop function if exists public.artist_reminders_touch_updated_at();
