-- Featured placement is an editorial/commercial decision. Owners may keep
-- editing the underlying opportunity, but cannot self-promote it by writing
-- the curated placement fields directly through PostgREST.

create or replace function public.enforce_studio_spot_curated_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_support_user()
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_featured, false)
       or new.featured_rank is not null
       or new.directory_rank is not null
    then
      raise exception 'Featured Spot placement is managed by We Otzi support.'
        using errcode = '42501';
    end if;
  elsif row(new.is_featured, new.featured_rank, new.directory_rank)
        is distinct from
        row(old.is_featured, old.featured_rank, old.directory_rank)
  then
    raise exception 'Featured Spot placement is managed by We Otzi support.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists studio_spots_protect_curated_fields
  on public.studio_spots;
create trigger studio_spots_protect_curated_fields
before insert or update on public.studio_spots
for each row execute function public.enforce_studio_spot_curated_fields();

create or replace function public.enforce_job_request_curated_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_support_user()
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_featured, false)
       or new.featured_rank is not null
       or nullif(btrim(new.sponsor_name), '') is not null
       or nullif(btrim(new.sponsor_description), '') is not null
       or coalesce(cardinality(new.featured_tags), 0) > 0
       or nullif(btrim(new.featured_image_url), '') is not null
       or new.featured_slots_count is not null
    then
      raise exception 'Sponsored Job Board placement is managed by We Otzi support.'
        using errcode = '42501';
    end if;
  elsif row(
          new.is_featured,
          new.featured_rank,
          new.sponsor_name,
          new.sponsor_description,
          new.featured_tags,
          new.featured_image_url,
          new.featured_slots_count
        ) is distinct from row(
          old.is_featured,
          old.featured_rank,
          old.sponsor_name,
          old.sponsor_description,
          old.featured_tags,
          old.featured_image_url,
          old.featured_slots_count
        )
  then
    raise exception 'Sponsored Job Board placement is managed by We Otzi support.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists job_board_requests_protect_curated_fields
  on public.job_board_requests;
create trigger job_board_requests_protect_curated_fields
before insert or update on public.job_board_requests
for each row execute function public.enforce_job_request_curated_fields();

revoke all on function public.enforce_studio_spot_curated_fields() from public, anon, authenticated;
revoke all on function public.enforce_job_request_curated_fields() from public, anon, authenticated;

comment on function public.enforce_studio_spot_curated_fields() is
  'Prevents studio owners from self-assigning featured and directory placement; support/service-role remain authorized.';
comment on function public.enforce_job_request_curated_fields() is
  'Prevents clients from self-assigning sponsored Job Board placement; support/service-role remain authorized.';
