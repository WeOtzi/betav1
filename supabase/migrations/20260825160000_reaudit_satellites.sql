-- Rediseño Bauhaus 2026 · Tablas satélite que pidió la re-auditoría de fidelidad
-- (25 ago). Sin tocar tablas legacy:
--  - client_profiles: datos del wizard nuevo de /client/register (username único,
--    nombre/apellido, país, foto, estilos favoritos, intención) — satélite de
--    clients_db keyed por auth user.
--  - client_favorites: corazones de favoritos del marketplace/explore.
--  - quotation_intake_extras: campos nuevos del wizard /quotation (modo de idea,
--    nivel de personalización, notas por referencia) — keyed por quote_id text,
--    con el MISMO modelo de acceso que quotations_db (insert abierto, borrador
--    anónimo mientras la cotización padre está in_progress, partes y soporte).
-- Aplicada al proyecto vivo el 25 ago 2026.

create table if not exists public.client_profiles (
  client_user_id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  first_name text,
  last_name text,
  country text,
  photo_url text,
  favorite_styles jsonb not null default '[]'::jsonb,
  signup_intent text,
  preferred_artist_user_id uuid,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_client_profiles_updated_at on public.client_profiles;
create trigger trg_client_profiles_updated_at
  before update on public.client_profiles
  for each row execute function public.set_updated_at();

alter table public.client_profiles enable row level security;

drop policy if exists client_profiles_owner_all on public.client_profiles;
create policy client_profiles_owner_all on public.client_profiles
  for all using ((select auth.uid()) = client_user_id)
  with check ((select auth.uid()) = client_user_id);

drop policy if exists client_profiles_support_read on public.client_profiles;
create policy client_profiles_support_read on public.client_profiles
  for select using (public.is_support_user());

create table if not exists public.client_favorites (
  client_user_id uuid not null references auth.users (id) on delete cascade,
  artist_user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (client_user_id, artist_user_id)
);

alter table public.client_favorites enable row level security;

drop policy if exists client_favorites_owner_all on public.client_favorites;
create policy client_favorites_owner_all on public.client_favorites
  for all using ((select auth.uid()) = client_user_id)
  with check ((select auth.uid()) = client_user_id);

drop policy if exists client_favorites_support_read on public.client_favorites;
create policy client_favorites_support_read on public.client_favorites
  for select using (public.is_support_user());

create table if not exists public.quotation_intake_extras (
  quote_id text primary key,
  idea_mode text check (idea_mode in ('idea', 'explorar')),
  personalization_level text
    check (personalization_level in ('tal_cual', 'interpretacion', 'propuesta')),
  reference_notes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_quotation_intake_extras_updated_at on public.quotation_intake_extras;
create trigger trg_quotation_intake_extras_updated_at
  before update on public.quotation_intake_extras
  for each row execute function public.set_updated_at();

alter table public.quotation_intake_extras enable row level security;

-- Espejo del modelo de quotations_db.
drop policy if exists qie_insert_open on public.quotation_intake_extras;
create policy qie_insert_open on public.quotation_intake_extras
  for insert with check (true);

drop policy if exists qie_select_parties on public.quotation_intake_extras;
create policy qie_select_parties on public.quotation_intake_extras
  for select using (
    exists (
      select 1 from public.quotations_db q
      where (q.quote_id)::text = quotation_intake_extras.quote_id
        and (
          (q.quote_status)::text = 'in_progress'
          or q.artist_id = (select auth.uid())
          or q.client_user_id = (select auth.uid())
        )
    )
    or public.is_support_user()
  );

drop policy if exists qie_update_draft_or_parties on public.quotation_intake_extras;
create policy qie_update_draft_or_parties on public.quotation_intake_extras
  for update using (
    exists (
      select 1 from public.quotations_db q
      where (q.quote_id)::text = quotation_intake_extras.quote_id
        and (
          (q.quote_status)::text = 'in_progress'
          or q.artist_id = (select auth.uid())
          or q.client_user_id = (select auth.uid())
        )
    )
    or public.is_support_user()
  );
