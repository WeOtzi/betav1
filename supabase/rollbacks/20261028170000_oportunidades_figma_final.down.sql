-- Reversa de supabase/migrations/20261028170000_oportunidades_figma_final.sql
-- Quita las columnas agregadas para el Figma final del área "oportunidades".
-- Los datos cargados en ellas se pierden; el frontend degrada solo (las lee con
-- fallback y vuelve a derivar requisitos/etiquetas de las columnas previas).

alter table public.job_board_requests
  drop constraint if exists job_board_requests_specific_requirements_len;
alter table public.studio_spots
  drop constraint if exists studio_spots_benefit_tags_len,
  drop constraint if exists studio_spots_availability_summary_len;

alter table public.job_board_requests
  drop column if exists specific_requirements;
alter table public.studio_spots
  drop column if exists benefit_tags,
  drop column if exists availability_summary;
