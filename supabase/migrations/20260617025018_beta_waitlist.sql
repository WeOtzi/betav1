-- beta_waitlist: captura de interes en la beta desde las landing pages por tipo de usuario
-- Aplicada al proyecto vivo flbgmlvfiejfttlawnfu (2026-06-17).

create table if not exists public.beta_waitlist (
  id uuid primary key default gen_random_uuid(),
  user_type text not null check (user_type in ('artist','client','studio')),
  email text,
  instagram text,
  source text,
  referrer text,
  user_agent text,
  locale text,
  created_at timestamptz not null default now(),
  constraint beta_waitlist_contact_present check (
    (email is not null and length(trim(email)) > 0)
    or (instagram is not null and length(trim(instagram)) > 0)
  )
);

comment on table public.beta_waitlist is 'Leads de interes en la beta capturados desde las landing pages (artist/client/studio).';

-- Dedup suave: un mismo contacto no se duplica por tipo de usuario
create unique index if not exists beta_waitlist_email_type_uidx
  on public.beta_waitlist (user_type, lower(email)) where email is not null;
create unique index if not exists beta_waitlist_ig_type_uidx
  on public.beta_waitlist (user_type, lower(instagram)) where instagram is not null;
create index if not exists beta_waitlist_created_at_idx on public.beta_waitlist (created_at desc);

-- RLS: anon/authenticated solo pueden INSERTAR; nadie salvo service_role puede leer
alter table public.beta_waitlist enable row level security;

drop policy if exists "anon_insert_waitlist" on public.beta_waitlist;
create policy "anon_insert_waitlist"
  on public.beta_waitlist
  for insert
  to anon, authenticated
  with check (true);
