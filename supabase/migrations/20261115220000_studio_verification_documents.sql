-- Verificación de estudios · documentos, sede y responsable (15 nov 2026, beta cerrada).
--
-- Figma de estudios 91wYIpURj0xn0kzqhybOOt, nodos 2012:307 (E-VER-01),
-- 2012:308 (E-VER-02), 2012:309 (E-VER-03), 2014:5245 y 2014:5246: el estudio
-- manda nombre legal o comercial, responsable y cargo, un contacto del
-- responsable, la sede a verificar, el documento que acredita la
-- representación y evidencia del espacio.
--
-- Sobre 20261102120000_studio_verification (ya aplicada en vivo):
--   1. Columnas nuevas en studio_verification_requests: legal_name,
--      responsible_role, responsible_contact, location_id y documents (jsonb).
--      El nombre del responsable reutiliza contact_name.
--   2. Bucket privado `studio-verification` (10 MB; PDF/JPG/PNG/WEBP), ruta
--      `<studio_id>/<archivo>`. El dueño sube y lee lo suyo; soporte lee todo.
--      Sin UPDATE ni DELETE: un documento enviado no se pisa.
--   3. RPC submit_studio_verification(p_studio_id, p_payload jsonb): valida y
--      abre (o actualiza) la solicitud pendiente con private.open_studio_verification.
--   4. La decisión se mueve a private.apply_studio_verification_decision:
--      - decide_studio_verification (soporte con su JWT) mantiene su firma.
--      - decide_studio_verification_as / revoke_studio_verification_as: solo
--        service_role. El servidor las llama después de autorizar al
--        superadmin del backoffice o a un agente de soporte activo, así el
--        backoffice no necesita que el superadmin esté en support_users_db.
--
-- Idempotente y aditiva. Reversa:
-- supabase/rollbacks/20261115220000_studio_verification_documents.down.sql

begin;

-- 1. Columnas ---------------------------------------------------------------
alter table public.studio_verification_requests
  add column if not exists legal_name text,
  add column if not exists responsible_role text,
  add column if not exists responsible_contact text,
  add column if not exists location_id uuid references public.studio_locations(id) on delete set null,
  add column if not exists documents jsonb not null default '[]'::jsonb;

alter table public.studio_verification_requests
  drop constraint if exists studio_verification_requests_legal_name_len,
  drop constraint if exists studio_verification_requests_responsible_role_len,
  drop constraint if exists studio_verification_requests_responsible_contact_len,
  drop constraint if exists studio_verification_requests_documents_shape;
alter table public.studio_verification_requests
  add constraint studio_verification_requests_legal_name_len
    check (legal_name is null or char_length(legal_name) <= 160),
  add constraint studio_verification_requests_responsible_role_len
    check (responsible_role is null or char_length(responsible_role) <= 120),
  add constraint studio_verification_requests_responsible_contact_len
    check (responsible_contact is null or char_length(responsible_contact) <= 160),
  add constraint studio_verification_requests_documents_shape
    check (jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) <= 10);

create index if not exists studio_verification_requests_location_idx
  on public.studio_verification_requests (location_id) where location_id is not null;

-- 2. Bucket privado ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-verification', 'studio-verification', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists studio_verification_owner_insert on storage.objects;
create policy studio_verification_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'studio-verification'
    and (storage.foldername(name))[1] in (
      select s.id::text from public.studios s where s.user_id = (select auth.uid())
    )
  );

drop policy if exists studio_verification_owner_select on storage.objects;
create policy studio_verification_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'studio-verification'
    and (storage.foldername(name))[1] in (
      select s.id::text from public.studios s where s.user_id = (select auth.uid())
    )
  );

drop policy if exists studio_verification_support_select on storage.objects;
create policy studio_verification_support_select on storage.objects
  for select to authenticated
  using (bucket_id = 'studio-verification' and public.is_support_user());

-- 3. Envío del estudio --------------------------------------------------------
create or replace function public.submit_studio_verification(p_studio_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_studio public.studios%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_legal text := nullif(pg_catalog.btrim(coalesce(v_payload->>'legal_name', '')), '');
  v_resp text := nullif(pg_catalog.btrim(coalesce(v_payload->>'responsible_name', '')), '');
  v_role text := nullif(pg_catalog.btrim(coalesce(v_payload->>'responsible_role', '')), '');
  v_contact text := nullif(pg_catalog.btrim(coalesce(v_payload->>'responsible_contact', '')), '');
  v_note text := nullif(pg_catalog.btrim(coalesce(v_payload->>'note', '')), '');
  v_location_text text := nullif(pg_catalog.btrim(coalesce(v_payload->>'location_id', '')), '');
  v_location uuid;
  v_docs jsonb := coalesce(v_payload->'documents', '[]'::jsonb);
  v_clean_docs jsonb := '[]'::jsonb;
  v_doc jsonb;
  v_kind text;
  v_path text;
  v_name text;
  v_links text[] := '{}'::text[];
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para verificar tu estudio.' using errcode = '42501';
  end if;
  select * into v_studio from public.studios s where s.id = p_studio_id for update;
  if not found or v_studio.user_id is distinct from v_uid then
    raise exception 'Solo el dueño del estudio puede pedir la verificación.' using errcode = '42501';
  end if;
  if v_studio.verification_status = 'verified' or v_studio.is_verified then
    raise exception 'Tu estudio ya está verificado.' using errcode = '23514';
  end if;

  if v_legal is null or char_length(v_legal) < 2 or char_length(v_legal) > 160 then
    raise exception 'Escribí el nombre legal o comercial del estudio.' using errcode = '22023';
  end if;
  if v_resp is null or char_length(v_resp) < 2 or char_length(v_resp) > 160 then
    raise exception 'Escribí el nombre del responsable del estudio.' using errcode = '22023';
  end if;
  if v_role is null or char_length(v_role) < 2 or char_length(v_role) > 120 then
    raise exception 'Contanos el cargo del responsable en el estudio.' using errcode = '22023';
  end if;
  if v_contact is null or char_length(v_contact) < 5 or char_length(v_contact) > 160 then
    raise exception 'Dejanos un email o teléfono del responsable.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'El comentario admite hasta 2000 caracteres.' using errcode = '22023';
  end if;

  if v_location_text is null or v_location_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Elegí la sede a verificar.' using errcode = '22023';
  end if;
  v_location := v_location_text::uuid;
  if not exists (
    select 1 from public.studio_locations l
    where l.id = v_location and l.studio_id = p_studio_id and coalesce(l.is_active, true)
  ) then
    raise exception 'La sede elegida no es de tu estudio.' using errcode = '22023';
  end if;

  if jsonb_typeof(v_docs) <> 'array' or jsonb_array_length(v_docs) = 0 then
    raise exception 'Subí el documento de representación y la evidencia del espacio.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_docs) > 10 then
    raise exception 'Podés adjuntar hasta 10 archivos.' using errcode = '22023';
  end if;
  for v_doc in select value from pg_catalog.jsonb_array_elements(v_docs) loop
    if jsonb_typeof(v_doc) <> 'object' then
      raise exception 'Revisá los archivos adjuntos.' using errcode = '22023';
    end if;
    v_kind := v_doc->>'kind';
    v_path := pg_catalog.btrim(coalesce(v_doc->>'path', ''));
    v_name := left(nullif(pg_catalog.btrim(coalesce(v_doc->>'name', '')), ''), 200);
    if v_kind is null or v_kind not in ('representation', 'space') then
      raise exception 'Revisá el tipo de cada archivo adjunto.' using errcode = '22023';
    end if;
    if v_path = '' or char_length(v_path) > 300
       or v_path not like p_studio_id::text || '/%' or v_path like '%..%' then
      raise exception 'Uno de los archivos no pertenece a tu estudio.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'studio-verification' and o.name = v_path
    ) then
      raise exception 'No encontramos uno de los archivos. Volvé a subirlo.' using errcode = '22023';
    end if;
    v_clean_docs := v_clean_docs || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind', v_kind,
      'path', v_path,
      'name', coalesce(v_name, pg_catalog.regexp_replace(v_path, '^.*/', '')),
      'mime', left(coalesce(v_doc->>'mime', ''), 80),
      'size', case when (v_doc->>'size') ~ '^[0-9]{1,9}$' then (v_doc->>'size')::bigint else null end,
      'uploaded_at', timezone('utc', now())
    ));
  end loop;
  if not exists (select 1 from pg_catalog.jsonb_array_elements(v_clean_docs) d where d->>'kind' = 'representation') then
    raise exception 'Falta el documento que acredita la representación del estudio.' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.jsonb_array_elements(v_clean_docs) d where d->>'kind' = 'space') then
    raise exception 'Falta la evidencia del espacio (fotos de la sede).' using errcode = '22023';
  end if;

  if jsonb_typeof(v_payload->'links') = 'array' then
    select coalesce(pg_catalog.array_agg(distinct pg_catalog.btrim(x)), '{}'::text[]) into v_links
    from pg_catalog.jsonb_array_elements_text(v_payload->'links') x
    where pg_catalog.btrim(x) <> '';
  end if;
  if pg_catalog.cardinality(v_links) > 5 then
    raise exception 'Podés sumar hasta 5 enlaces.' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.unnest(v_links) x where x !~* '^https?://[^\s/?#]+[^\s]*$' or char_length(x) > 500) then
    raise exception 'Los enlaces tienen que empezar con http:// o https://.' using errcode = '22023';
  end if;

  v_id := private.open_studio_verification(p_studio_id, 'owner_request', null, v_uid);
  update public.studio_verification_requests r
  set legal_name = v_legal,
      contact_name = v_resp,
      responsible_role = v_role,
      responsible_contact = v_contact,
      location_id = v_location,
      documents = v_clean_docs,
      evidence = v_note,
      links = v_links,
      requested_by = coalesce(r.requested_by, v_uid),
      updated_at = timezone('utc', now())
  where r.id = v_id;
  return v_id;
end;
$function$;

revoke all on function public.submit_studio_verification(uuid, jsonb) from public, anon;
grant execute on function public.submit_studio_verification(uuid, jsonb) to authenticated, service_role;

-- 4. Decisión -------------------------------------------------------------------
create or replace function private.apply_studio_verification_decision(
  p_request_id uuid, p_decision text, p_note text, p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_request public.studio_verification_requests%rowtype;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_now timestamptz := timezone('utc', now());
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'Decisión no válida.' using errcode = '22023';
  end if;
  if p_decision = 'reject' and (v_note is null or char_length(v_note) < 3) then
    raise exception 'Contale al estudio por qué no aprobamos la verificación.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'La nota admite hasta 1000 caracteres.' using errcode = '22023';
  end if;
  select * into v_request from public.studio_verification_requests r where r.id = p_request_id for update;
  if not found then raise exception 'Solicitud no encontrada.' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then raise exception 'La solicitud ya fue resuelta.' using errcode = '23514'; end if;

  update public.studio_verification_requests r
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      decided_at = v_now, decided_by = p_actor, decision_note = v_note, updated_at = v_now
  where r.id = p_request_id;

  if p_decision = 'approve' then
    update public.studios s
    set is_verified = true, verification_status = 'verified', verified_at = v_now,
        verification_required = false, verification_reason = null
    where s.id = v_request.studio_id;
  else
    update public.studios s
    set is_verified = false, verification_status = 'rejected', verified_at = null
    where s.id = v_request.studio_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', p_request_id,
    'studio_id', v_request.studio_id,
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end
  );
end;
$function$;

revoke all on function private.apply_studio_verification_decision(uuid, text, text, uuid) from public, anon, authenticated;

-- Misma firma y mismo contrato que 20261102120000: soporte con su JWT.
create or replace function public.decide_studio_verification(p_request_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.is_support_user() then
    raise exception 'Solo soporte de We Ötzi decide verificaciones.' using errcode = '42501';
  end if;
  return private.apply_studio_verification_decision(p_request_id, p_decision, p_note, auth.uid());
end;
$function$;

-- Servidor (service_role): el endpoint ya autorizó al superadmin o al agente.
create or replace function public.decide_studio_verification_as(
  p_request_id uuid, p_decision text, p_note text default null, p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Solo el servidor de We Ötzi puede usar esta función.' using errcode = '42501';
  end if;
  return private.apply_studio_verification_decision(p_request_id, p_decision, p_note, p_actor);
end;
$function$;

revoke all on function public.decide_studio_verification_as(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.decide_studio_verification_as(uuid, text, text, uuid) to service_role;

-- Quitar el sello a un estudio verificado (reemplaza el toggle is_verified
-- del backoffice). Deja constancia en una solicitud 'cancelled'.
create or replace function public.revoke_studio_verification_as(
  p_studio_id uuid, p_note text, p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_now timestamptz := timezone('utc', now());
  v_studio public.studios%rowtype;
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Solo el servidor de We Ötzi puede usar esta función.' using errcode = '42501';
  end if;
  if v_note is null or char_length(v_note) < 3 or char_length(v_note) > 1000 then
    raise exception 'Escribí el motivo (entre 3 y 1000 caracteres).' using errcode = '22023';
  end if;
  select * into v_studio from public.studios s where s.id = p_studio_id for update;
  if not found then raise exception 'Estudio no encontrado.' using errcode = 'P0002'; end if;
  if not (v_studio.is_verified or v_studio.verification_status = 'verified') then
    raise exception 'El estudio no está verificado.' using errcode = '23514';
  end if;

  update public.studio_verification_requests r
  set status = 'cancelled', decided_at = v_now, decided_by = p_actor,
      decision_note = v_note, updated_at = v_now
  where r.studio_id = p_studio_id and r.status = 'pending';

  insert into public.studio_verification_requests
    (studio_id, requested_by, status, reasons, decided_at, decided_by, decision_note)
  values (p_studio_id, null, 'cancelled', '{}'::text[], v_now, p_actor, v_note)
  returning id into v_id;

  update public.studios s
  set is_verified = false, verification_status = 'unverified', verified_at = null
  where s.id = p_studio_id;

  return pg_catalog.jsonb_build_object('id', v_id, 'studio_id', p_studio_id, 'status', 'revoked');
end;
$function$;

revoke all on function public.revoke_studio_verification_as(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.revoke_studio_verification_as(uuid, text, uuid) to service_role;

commit;
