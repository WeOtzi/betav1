begin;

-- The slug preflight and its following constraint/grant replacement must see a
-- stable set of trips and commit atomically with the bucket hardening.
lock table public.artist_trips in share row exclusive mode;

-- Fail before changing constraints if an older deployment already contains two
-- spellings that would resolve to the same public URL.
do $$
declare
  v_collision text;
begin
  select lower(share_slug)
    into v_collision
  from public.artist_trips
  where share_slug is not null
  group by lower(share_slug)
  having count(*) > 1
  limit 1;

  if v_collision is not null then
    raise exception 'Case-insensitive Travel share slug collision: %', v_collision;
  end if;

  if exists (
    select 1
    from public.artist_trips
    where share_slug is not null
      and (
        share_slug <> lower(btrim(share_slug))
        or char_length(share_slug) not between 8 and 160
        or share_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      )
  ) then
    raise exception 'Existing Travel share slugs do not satisfy the normalized contract';
  end if;
end
$$;

alter table public.artist_trips
  drop constraint if exists artist_trips_share_slug_format_check;
alter table public.artist_trips
  add constraint artist_trips_share_slug_format_check check (
    share_slug is null
    or (
      share_slug = lower(btrim(share_slug))
      and char_length(share_slug) between 8 and 160
      and share_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    )
  );

alter table public.artist_trips
  drop constraint if exists artist_trips_share_enabled_slug_check;
alter table public.artist_trips
  add constraint artist_trips_share_enabled_slug_check check (
    share_enabled = false or share_slug is not null
  );

create unique index if not exists uq_artist_trips_share_slug_ci
  on public.artist_trips (lower(share_slug))
  where share_slug is not null;

-- Owners may read and edit the descriptive allowlist, but lifecycle, origin,
-- ownership and dates remain RPC-only. A direct DELETE can no longer cascade
-- away studio-link audit history.
drop policy if exists artist_trips_owner_all on public.artist_trips;
drop policy if exists artist_trips_owner_select on public.artist_trips;
create policy artist_trips_owner_select on public.artist_trips
  for select to authenticated
  using ((select auth.uid()) = artist_user_id);

drop policy if exists artist_trips_owner_update on public.artist_trips;
create policy artist_trips_owner_update on public.artist_trips
  for update to authenticated
  using ((select auth.uid()) = artist_user_id)
  with check ((select auth.uid()) = artist_user_id);

revoke all privileges on table public.artist_trips from authenticated;
grant select on table public.artist_trips to authenticated;
grant update (
  city,
  country,
  region,
  trip_type,
  studio_name_hint,
  event_name,
  agreed_conditions,
  personal_notes,
  share_slug,
  share_enabled
) on table public.artist_trips to authenticated;

-- Travel document uploads are private and intentionally bounded to the formats
-- accepted by the artist UI. The existing owner-folder RLS remains unchanged.
do $$
begin
  update storage.buckets
  set file_size_limit = 10485760,
      allowed_mime_types = array[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp'
      ]::text[]
  where id = 'artist-trip-docs';

  if not found then
    raise exception 'Required private bucket artist-trip-docs does not exist';
  end if;
end
$$;

commit;
