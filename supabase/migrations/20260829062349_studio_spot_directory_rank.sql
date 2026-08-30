-- Stable editorial order for organic and featured cards. `featured_rank`
-- controls promoted placement; `directory_rank` controls the complete mosaic.

alter table public.studio_spots
  add column if not exists directory_rank smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.studio_spots'::regclass
      and conname='studio_spots_directory_rank_positive'
  ) then
    alter table public.studio_spots
      add constraint studio_spots_directory_rank_positive
      check (directory_rank is null or directory_rank > 0);
  end if;
end
$$;

create index if not exists idx_studio_spots_open_directory_rank
  on public.studio_spots (directory_rank, created_at desc)
  where status='open';

comment on column public.studio_spots.directory_rank is
  'Orden editorial estable de todas las oportunidades del directorio de Spots.';
