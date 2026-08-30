-- Persistent public codes and editorial ordering for the Job Board feed.

alter table public.job_board_requests
  add column if not exists display_code text,
  add column if not exists feed_rank smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_board_requests'::regclass
      and conname = 'job_board_requests_display_code_format'
  ) then
    alter table public.job_board_requests
      add constraint job_board_requests_display_code_format
      check (display_code is null or display_code ~ '^JB-[0-9]{5}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_board_requests'::regclass
      and conname = 'job_board_requests_feed_rank_positive'
  ) then
    alter table public.job_board_requests
      add constraint job_board_requests_feed_rank_positive
      check (feed_rank is null or feed_rank > 0);
  end if;
end
$$;

create unique index if not exists idx_job_board_open_public_feed_rank
  on public.job_board_requests (feed_rank)
  where status = 'open' and is_public = true and is_featured = false
    and feed_rank is not null;

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
       or nullif(btrim(new.display_code), '') is not null
       or new.feed_rank is not null
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
          new.featured_slots_count,
          new.display_code,
          new.feed_rank
        ) is distinct from row(
          old.is_featured,
          old.featured_rank,
          old.sponsor_name,
          old.sponsor_description,
          old.featured_tags,
          old.featured_image_url,
          old.featured_slots_count,
          old.display_code,
          old.feed_rank
        )
  then
    raise exception 'Sponsored Job Board placement is managed by We Otzi support.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_job_request_curated_fields()
  from public, anon, authenticated;

comment on column public.job_board_requests.display_code is
  'Código público estable de cinco dígitos mostrado en las tarjetas del Job Board.';
comment on column public.job_board_requests.feed_rank is
  'Orden editorial único de las solicitudes abiertas y públicas del Job Board.';
comment on function public.enforce_job_request_curated_fields() is
  'Prevents clients from assigning sponsored placement, public display codes or feed order; support/service-role remain authorized.';
