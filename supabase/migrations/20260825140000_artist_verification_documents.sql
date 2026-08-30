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
  reviewer_notes text,
  unique (artist_user_id, doc_type)
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
  for all using (public.is_support_user())
  with check (public.is_support_user());

-- Grants and RLS are independent in Postgres. Keep the table off the anonymous
-- Data API and grant artists only the operations their owner policies allow.
revoke all on table public.artist_verification_documents from anon;
revoke all on table public.artist_verification_documents from authenticated;
grant select, insert, update, delete on table public.artist_verification_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artist-verification',
  'artist-verification',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Split storage permissions so an artist cannot overwrite or delete the file
-- behind an already verified document. Once a pending/rejected DB row is
-- deleted, its now-unreferenced object can still be cleaned up safely.
drop policy if exists "artist_verification_owner_all" on storage.objects;
drop policy if exists "artist_verification_owner_select" on storage.objects;
create policy "artist_verification_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'artist-verification'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "artist_verification_owner_insert" on storage.objects;
create policy "artist_verification_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'artist-verification'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "artist_verification_owner_update" on storage.objects;
create policy "artist_verification_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'artist-verification'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.artist_verification_documents d
      where d.artist_user_id = (select auth.uid())
        and d.storage_path = name
        and d.status = 'verificado'
    ))
  with check (bucket_id = 'artist-verification'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "artist_verification_owner_delete" on storage.objects;
create policy "artist_verification_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'artist-verification'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.artist_verification_documents d
      where d.artist_user_id = (select auth.uid())
        and d.storage_path = name
        and d.status = 'verificado'
    ));

drop policy if exists "artist_verification_support_read" on storage.objects;
create policy "artist_verification_support_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'artist-verification' and public.is_support_user());
