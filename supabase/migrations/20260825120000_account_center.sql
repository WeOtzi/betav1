-- Rediseño Bauhaus 2026 · Centro de la cuenta (/artist/account y /client/profile)
-- Backend mínimo para las secciones que hoy no tienen datos:
--  - user_preferences: preferencias de notificaciones / privacidad / app por usuario
--    (sirve a artistas y clientes; JSONB para iterar sin más migraciones).
--    El horario semanal de Disponibilidad vive en app_settings.availability
--    (se decidió no alterar artists_db).
--  - artist_billing_profiles: datos fiscales del artista (sección Cobros y
--    facturación). Métodos de pago NO se almacenan (sin procesador integrado).
-- Los documentos de Verificación van en la migración
-- 20260825140000_artist_verification_documents.sql (pendiente de aplicar).
-- Solo cambios aditivos. Aplicada al proyecto vivo el 25 ago 2026 en dos partes
-- (user_preferences, artist_billing_profiles).

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  notification_prefs jsonb not null default '{}'::jsonb,
  privacy jsonb not null default '{}'::jsonb,
  app_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_user_preferences_updated_at on public.user_preferences;
create trigger trg_user_preferences_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_owner_all on public.user_preferences;
create policy user_preferences_owner_all on public.user_preferences
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_preferences_support_read on public.user_preferences;
create policy user_preferences_support_read on public.user_preferences
  for select using (public.is_support_user());

create table if not exists public.artist_billing_profiles (
  artist_user_id uuid primary key references auth.users (id) on delete cascade,
  legal_name text,
  tax_id text,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_artist_billing_updated_at on public.artist_billing_profiles;
create trigger trg_artist_billing_updated_at
  before update on public.artist_billing_profiles
  for each row execute function public.set_updated_at();

alter table public.artist_billing_profiles enable row level security;

drop policy if exists artist_billing_owner_all on public.artist_billing_profiles;
create policy artist_billing_owner_all on public.artist_billing_profiles
  for all using ((select auth.uid()) = artist_user_id)
  with check ((select auth.uid()) = artist_user_id);

drop policy if exists artist_billing_support_read on public.artist_billing_profiles;
create policy artist_billing_support_read on public.artist_billing_profiles
  for select using (public.is_support_user());
