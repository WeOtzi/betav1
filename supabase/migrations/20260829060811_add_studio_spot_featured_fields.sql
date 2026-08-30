-- Persistent editorial placement for the public Spots directory.
-- The flag belongs to the opportunity (not the studio): the same studio can
-- have both a promoted and an organic spot at the same time.

alter table public.studio_spots
  add column if not exists is_featured boolean not null default false,
  add column if not exists featured_rank smallint,
  add column if not exists studio_includes text[] not null default array[]::text[],
  add column if not exists artist_expectations text[] not null default array[]::text[],
  add column if not exists minimum_requirements text[] not null default array[]::text[],
  add column if not exists stipend_frequency text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.studio_spots'::regclass
      and conname = 'studio_spots_featured_rank_positive'
  ) then
    alter table public.studio_spots
      add constraint studio_spots_featured_rank_positive
      check (featured_rank is null or featured_rank > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.studio_spots'::regclass
      and conname = 'studio_spots_stipend_frequency_check'
  ) then
    alter table public.studio_spots
      add constraint studio_spots_stipend_frequency_check
      check (stipend_frequency is null or stipend_frequency in ('weekly', 'monthly', 'one_time'));
  end if;
end
$$;

create unique index if not exists idx_studio_spots_open_featured_rank
  on public.studio_spots (featured_rank)
  where status = 'open' and is_featured = true and featured_rank is not null;

create index if not exists idx_studio_spots_open_editorial_order
  on public.studio_spots (is_featured desc, featured_rank asc, created_at desc)
  where status = 'open';

comment on column public.studio_spots.is_featured is
  'Destacado editorial persistente del directorio de Spots.';
comment on column public.studio_spots.featured_rank is
  'Orden de los Spots destacados: 1 es el hero; 2 o mayor ocupa promociones del mosaico.';
comment on column public.studio_spots.studio_includes is
  'Lista editorial de recursos y beneficios incluidos por el estudio.';
comment on column public.studio_spots.artist_expectations is
  'Lista editorial de compromisos esperados del artista.';
comment on column public.studio_spots.minimum_requirements is
  'Lista editorial de requisitos mínimos para postularse.';
comment on column public.studio_spots.stipend_frequency is
  'Frecuencia del stipend: weekly, monthly u one_time.';
