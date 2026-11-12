-- Reversa de 20261112150000_guard_verification_jobboard.sql
drop trigger if exists trg_guard_job_board_application_update on public.job_board_applications;
drop trigger if exists trg_guard_artist_verification_document on public.artist_verification_documents;
drop trigger if exists trg_guard_artist_privileged_fields on public.artists_db;
drop function if exists public.guard_job_board_application_update();
drop function if exists public.guard_artist_verification_document();
drop function if exists public.guard_artist_privileged_fields();
drop function if exists public.wo_is_privileged_writer();
