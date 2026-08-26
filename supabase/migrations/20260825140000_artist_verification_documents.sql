-- ⚠️ PENDIENTE DE APLICAR (25 ago 2026): esta migración fue escrita durante la
-- sesión autónoma del rediseño pero el permission gate bloqueó aplicarla porque
-- crea infraestructura para recolectar documentos de identidad — corresponde
-- aplicarla manualmente (Isaí) desde una sesión interactiva o con la CLI.
-- Mientras no esté aplicada, la sección Verificación de /artist/account muestra
-- el estado (verification_state/verification_history) con la carga de
-- documentos deshabilitada (account-repo.js degrada si la tabla no existe).
--
-- Rediseño Bauhaus 2026 · Documentos de la sección Verificación del artista.
-- Tabla nueva + bucket privado (carpeta raíz = uid del artista). El artista
-- sube y ve sus documentos; soporte revisa y decide.

create table if not exists public.artist_verification_documents (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  doc_type text not null check (doc_type in ('identidad', 'bioseguridad', 'domicilio')),
  file_name text not null,
  storage_path text not null,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'verificado', 'rechazado')),
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_notes text
);
create index if not exists idx_artist_verification_docs_artist
  on public.artist_verification_documents (artist_user_id);

alter table public.artist_verification_documents enable row level security;

drop policy if exists artist_verification_docs_owner_rw on public.artist_verification_documents;
create policy artist_verification_docs_owner_rw on public.artist_verification_documents
  for select using ((select auth.uid()) = artist_user_id);

drop policy if exists artist_verification_docs_owner_insert on public.artist_verification_documents;
create policy artist_verification_docs_owner_insert on public.artist_verification_documents
  for insert with check ((select auth.uid()) = artist_user_id);

drop policy if exists artist_verification_docs_owner_delete on public.artist_verification_documents;
create policy artist_verification_docs_owner_delete on public.artist_verification_documents
  for delete using ((select auth.uid()) = artist_user_id and status = 'pendiente');

drop policy if exists artist_verification_docs_support_all on public.artist_verification_documents;
create policy artist_verification_docs_support_all on public.artist_verification_documents
  for all using (public.is_support_user());

insert into storage.buckets (id, name, public)
values ('artist-verification', 'artist-verification', false)
on conflict (id) do nothing;

drop policy if exists "artist_verification_owner_all" on storage.objects;
create policy "artist_verification_owner_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'artist-verification'
    and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'artist-verification'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "artist_verification_support_read" on storage.objects;
create policy "artist_verification_support_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'artist-verification' and public.is_support_user());
