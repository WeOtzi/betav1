-- Figma final del flujo de artista (oct 2026) · área "oportunidades".
-- Datos que muestran los frames del Job Board y de Spots y que no existían:
--   1. job_board_requests.specific_requirements — lista "Requisitos específicos"
--      del detalle de la solicitud (frame 801:1068). La carga el cliente al
--      publicar; hasta entonces el detalle deriva requisitos de otras columnas.
--   2. studio_spots.benefit_tags — etiquetas cortas de la oferta ("Agenda
--      garantizada", "Materiales incluidos"…) del seguimiento del spot (801:1074).
--   3. studio_spots.availability_summary — texto libre de "Fechas disponibles"
--      del detalle del spot (801:538), p. ej. "3 a 6 meses, inicio flexible…".
--
-- Aditiva e idempotente. Las tres columnas viven en tablas que ya tienen RLS
-- habilitada (las políticas de fila existentes cubren las columnas nuevas); se
-- reafirma `enable row level security` por si un entorno quedó sin activar.
-- Reversa: supabase/rollbacks/20261028170000_oportunidades_figma_final.down.sql

alter table public.job_board_requests
  add column if not exists specific_requirements text[] not null default array[]::text[];

alter table public.studio_spots
  add column if not exists benefit_tags text[] not null default array[]::text[],
  add column if not exists availability_summary text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.job_board_requests'::regclass
      and conname = 'job_board_requests_specific_requirements_len'
  ) then
    alter table public.job_board_requests
      add constraint job_board_requests_specific_requirements_len
      check (cardinality(specific_requirements) <= 8);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.studio_spots'::regclass
      and conname = 'studio_spots_benefit_tags_len'
  ) then
    alter table public.studio_spots
      add constraint studio_spots_benefit_tags_len
      check (cardinality(benefit_tags) <= 6);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.studio_spots'::regclass
      and conname = 'studio_spots_availability_summary_len'
  ) then
    alter table public.studio_spots
      add constraint studio_spots_availability_summary_len
      check (availability_summary is null or char_length(availability_summary) <= 160);
  end if;
end;
$$;

comment on column public.job_board_requests.specific_requirements is
  'Requisitos específicos del cliente para la solicitud (máx. 8). Detalle del Job Board del artista.';
comment on column public.studio_spots.benefit_tags is
  'Etiquetas cortas de beneficios del spot (máx. 6). Seguimiento de la postulación del artista.';
comment on column public.studio_spots.availability_summary is
  'Resumen libre de las fechas disponibles del spot (máx. 160 caracteres).';

alter table public.job_board_requests enable row level security;
alter table public.studio_spots enable row level security;
