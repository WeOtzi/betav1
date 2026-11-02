-- Verificación de estudios + coincidencias en el registro (revisión "Estudios v1").
--
-- 1. find_studio_matches(nombre, instagram): el paso 1 del registro avisa si el
--    estudio ya existe o se parece a uno registrado (con o sin dueño) y ofrece
--    iniciar sesión, reclamarlo, cambiar el nombre, registrar una sede o seguir.
--    Coincidencia por tokens del nombre (sin acentos ni palabras genéricas como
--    "estudio" o "tattoo") o por la misma cuenta de Instagram. Solo devuelve
--    datos públicos de la ficha (nombre, ciudad, logo y direcciones de sedes).
-- 2. complete_studio_registration: si el estudio nuevo coincide con otro, no
--    puede compartir dirección con sus sedes (40 m o la misma dirección
--    formateada) y queda con verificación adicional pendiente
--    (verification_required + una solicitud con motivo name_match /
--    instagram_match). El nombre exacto sigue siendo único (UNIQUE
--    normalized_name, del que dependen los flujos del artista): para un nombre
--    idéntico el registro pide uno que lo distinga.
-- 3. Verificación del estudio: studios.verification_status
--    (unverified | pending | verified | rejected) junto a is_verified, la tabla
--    studio_verification_requests (el dueño la crea por RPC; soporte decide) y
--    studio_instagram_verifications (códigos WO-XXXXXX por DM a @weotzi, solo
--    service_role: el servidor guarda el hash, nunca el código).
--    Solo soporte o el servidor cambian las columnas de verificación (guard).
--
-- Aditiva e idempotente. Reversa:
--   supabase/rollbacks/20261102120000_studio_verification.down.sql

begin;

-- ===================== columnas de verificación =====================
alter table public.studios
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verification_required boolean not null default false,
  add column if not exists verification_reason text,
  add column if not exists verified_at timestamptz,
  add column if not exists instagram_verified_at timestamptz,
  add column if not exists instagram_verified_handle text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'studios_verification_status_check') then
    alter table public.studios add constraint studios_verification_status_check
      check (verification_status in ('unverified', 'pending', 'verified', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'studios_verification_reason_check') then
    alter table public.studios add constraint studios_verification_reason_check
      check (verification_reason is null or verification_reason in ('name_match', 'instagram_match', 'owner_request'));
  end if;
end $$;

-- Los estudios ya verificados por soporte quedan "verified".
update public.studios
set verification_status = 'verified', verified_at = coalesce(verified_at, updated_at, created_at)
where is_verified is true and verification_status = 'unverified';

comment on column public.studios.verification_status is
  'unverified | pending | verified | rejected. Solo soporte o el servidor lo cambian (guard_studio_protected_columns).';
comment on column public.studios.verification_required is
  'true cuando el registro coincidió con otro estudio: necesita verificación adicional de soporte.';

-- ===================== guard de columnas protegidas =====================
create or replace function private.guard_studio_protected_columns()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_support_user() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_verified := false;
    new.verification_status := 'unverified';
    new.verification_required := false;
    new.verification_reason := null;
    new.verified_at := null;
    new.instagram_verified_at := null;
    new.instagram_verified_handle := null;
    return new;
  end if;

  if new.is_verified is distinct from old.is_verified
     or new.verification_status is distinct from old.verification_status
     or new.verification_required is distinct from old.verification_required
     or new.verification_reason is distinct from old.verification_reason
     or new.verified_at is distinct from old.verified_at
     or new.instagram_verified_at is distinct from old.instagram_verified_at
     or new.instagram_verified_handle is distinct from old.instagram_verified_handle then
    raise exception 'La verificación del estudio la gestiona soporte de We Ötzi.' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'El dueño del estudio solo cambia con un reclamo aprobado por soporte.' using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- ===================== normalización de nombres =====================
-- Clave sin acentos, en minúsculas y con espacios simples.
create or replace function private.studio_name_key(p_name text)
returns text
language sql
immutable
set search_path to ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.translate(coalesce(p_name, ''),
      'ÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕØÚÙÜÛÑÇáàäâãåéèëêíìïîóòöôõøúùüûñç',
      'AAAAAAEEEEIIIIOOOOOOUUUUNCaaaaaaeeeeiiiioooooouuuunc')),
    '[^a-z0-9]+', ' ', 'g'));
$$;

-- Tokens significativos: sin palabras genéricas del rubro ni conectores.
create or replace function private.studio_name_tokens(p_name text)
returns text[]
language sql
immutable
set search_path to ''
as $$
  select coalesce(pg_catalog.array_agg(distinct t order by t), '{}'::text[])
  from pg_catalog.unnest(pg_catalog.string_to_array(private.studio_name_key(p_name), ' ')) as t
  where pg_catalog.length(t) > 1
    and t not in ('estudio', 'studio', 'studios', 'estudios', 'tattoo', 'tattoos', 'tatuaje', 'tatuajes',
                  'the', 'de', 'del', 'la', 'el', 'los', 'las', 'and', 'co');
$$;

-- Usuario de Instagram normalizado (acepta @handle o la URL del perfil).
create or replace function private.studio_instagram_key(p_value text)
returns text
language sql
immutable
set search_path to ''
as $$
  select nullif(pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, ''))),
    '^(https?://)?(www\.)?instagram\.com/', ''), '^@+|[/?#].*$', '', 'g'), '');
$$;

-- ¿Dos nombres son el mismo estudio o se parecen lo suficiente para avisar?
-- exact: misma clave. similar: los tokens del nombre más corto aparecen en el
-- otro (≥ 60 %) o una clave sin espacios contiene a la otra (≥ 5 letras).
create or replace function private.studio_name_match(p_a text, p_b text)
returns text
language plpgsql
immutable
set search_path to ''
as $$
declare
  ka text := private.studio_name_key(p_a);
  kb text := private.studio_name_key(p_b);
  ta text[] := private.studio_name_tokens(p_a);
  tb text[] := private.studio_name_tokens(p_b);
  ca text := pg_catalog.replace(ka, ' ', '');
  cb text := pg_catalog.replace(kb, ' ', '');
  inter integer;
  smaller integer;
begin
  if ka = '' or kb = '' then return null; end if;
  if ka = kb then return 'exact'; end if;
  if pg_catalog.cardinality(ta) > 0 and pg_catalog.cardinality(tb) > 0 then
    select count(*) into inter from pg_catalog.unnest(ta) x where x = any (tb);
    smaller := least(pg_catalog.cardinality(ta), pg_catalog.cardinality(tb));
    if inter > 0 and inter::numeric / smaller >= 0.6 then return 'similar'; end if;
  end if;
  if least(pg_catalog.length(ca), pg_catalog.length(cb)) >= 5
     and (pg_catalog.strpos(ca, cb) > 0 or pg_catalog.strpos(cb, ca) > 0) then
    return 'similar';
  end if;
  return null;
end;
$$;

-- Coincidencias de un nombre / Instagram con estudios existentes (máx. 8).
-- Excluye el estudio de la cuenta que pregunta.
create or replace function private.studio_matches(p_name text, p_instagram text default null)
returns table (studio_id uuid, match_kind text)
language sql
stable
security definer
set search_path to ''
as $$
  with q as (
    select private.studio_instagram_key(p_instagram) as ig
  ), scored as (
    select s.id,
           private.studio_name_match(p_name, s.name) as by_name,
           case when q.ig is not null and private.studio_instagram_key(s.instagram) = q.ig then 'instagram' end as by_ig
    from public.studios s, q
    where s.user_id is distinct from auth.uid()
  )
  select id, coalesce(by_name, by_ig)
  from scored
  where by_name is not null or by_ig is not null
  order by case coalesce(by_name, by_ig) when 'exact' then 0 when 'instagram' then 1 else 2 end, id
  limit 8;
$$;

revoke all on function private.studio_matches(text, text) from public, anon, authenticated;

create or replace function public.find_studio_matches(p_name text, p_instagram text default null)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'slug', s.slug,
      'city', s.city,
      'country', s.country,
      'logo_image', s.logo_image,
      'owned', s.user_id is not null,
      'verified', coalesce(s.is_verified, false),
      'match', m.match_kind,
      'locations', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'label', l.label, 'formatted_address', l.formatted_address, 'city', l.city,
          'latitude', l.latitude, 'longitude', l.longitude) order by l.is_primary desc, l.sort_order)
        from public.studio_locations l
        where l.studio_id = s.id and l.is_active is not false
      ), case when s.formatted_address is not null or s.latitude is not null then pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'label', 'Dirección del estudio', 'formatted_address', s.formatted_address, 'city', s.city,
          'latitude', s.latitude, 'longitude', s.longitude)) else '[]'::jsonb end)
    ) order by case m.match_kind when 'exact' then 0 when 'instagram' then 1 else 2 end, s.name), '[]'::jsonb)
  from private.studio_matches(
         case when pg_catalog.length(pg_catalog.btrim(coalesce(p_name, ''))) between 2 and 160 then p_name end,
         case when pg_catalog.length(coalesce(p_instagram, '')) <= 200 then p_instagram end) m
  join public.studios s on s.id = m.studio_id;
$$;

revoke all on function public.find_studio_matches(text, text) from public;
grant execute on function public.find_studio_matches(text, text) to anon, authenticated;

comment on function public.find_studio_matches(text, text) is
  'Estudios que coinciden con un nombre (exact | similar) o un Instagram (instagram). Datos públicos de la ficha y sus sedes activas.';

-- Distancia aproximada en metros (equirrectangular; alcanza para < 1 km).
create or replace function private.approx_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
set search_path to ''
as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null else
    6371000 * pg_catalog.sqrt(pg_catalog.power(pg_catalog.radians(lat2 - lat1), 2)
      + pg_catalog.power(pg_catalog.cos(pg_catalog.radians((lat1 + lat2) / 2)) * pg_catalog.radians(lng2 - lng1), 2)) end;
$$;

-- ===================== solicitudes de verificación =====================
create table if not exists public.studio_verification_requests (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending',
  reasons text[] not null default '{}'::text[],
  matched_studio_ids uuid[] not null default '{}'::uuid[],
  evidence text,
  contact_name text,
  contact_phone text,
  links text[] not null default '{}'::text[],
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  decided_at timestamptz,
  decided_by uuid,
  decision_note text,
  constraint studio_verification_requests_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint studio_verification_requests_reasons_check check (reasons <@ array['name_match', 'instagram_match', 'owner_request']::text[]),
  constraint studio_verification_requests_evidence_len check (evidence is null or char_length(evidence) <= 2000),
  constraint studio_verification_requests_contact_name_len check (contact_name is null or char_length(contact_name) <= 160),
  constraint studio_verification_requests_contact_phone_len check (contact_phone is null or char_length(contact_phone) <= 40),
  constraint studio_verification_requests_links_len check (cardinality(links) <= 5),
  constraint studio_verification_requests_note_len check (decision_note is null or char_length(decision_note) <= 1000)
);

comment on table public.studio_verification_requests is
  'Verificación de estudios. El dueño la pide (request_studio_verification) o el registro la abre al coincidir con otro estudio; soporte decide (decide_studio_verification).';

create unique index if not exists studio_verification_requests_one_pending
  on public.studio_verification_requests (studio_id) where status = 'pending';
create index if not exists studio_verification_requests_studio_recent_idx
  on public.studio_verification_requests (studio_id, created_at desc);
create index if not exists studio_verification_requests_pending_idx
  on public.studio_verification_requests (created_at) where status = 'pending';

alter table public.studio_verification_requests enable row level security;
revoke all on public.studio_verification_requests from anon, authenticated;
grant select on public.studio_verification_requests to authenticated;

drop policy if exists studio_verification_requests_owner_select on public.studio_verification_requests;
create policy studio_verification_requests_owner_select on public.studio_verification_requests
  for select to authenticated
  using (exists (select 1 from public.studios s where s.id = studio_id and s.user_id = (select auth.uid())));

drop policy if exists studio_verification_requests_support_select on public.studio_verification_requests;
create policy studio_verification_requests_support_select on public.studio_verification_requests
  for select to authenticated
  using (public.is_support_user());

-- Abre (o reutiliza) la solicitud pendiente de un estudio. Uso interno.
create or replace function private.open_studio_verification(
  p_studio_id uuid, p_reason text, p_matched uuid[], p_requested_by uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
begin
  select r.id into v_id from public.studio_verification_requests r
  where r.studio_id = p_studio_id and r.status = 'pending'
  for update;
  if found then
    update public.studio_verification_requests r
    set reasons = (select pg_catalog.array_agg(distinct x) from pg_catalog.unnest(r.reasons || array[p_reason]) x),
        matched_studio_ids = (select coalesce(pg_catalog.array_agg(distinct x), '{}'::uuid[]) from pg_catalog.unnest(r.matched_studio_ids || coalesce(p_matched, '{}'::uuid[])) x),
        updated_at = timezone('utc', now())
    where r.id = v_id;
  else
    insert into public.studio_verification_requests (studio_id, requested_by, reasons, matched_studio_ids)
    values (p_studio_id, p_requested_by, array[p_reason], coalesce(p_matched, '{}'::uuid[]))
    returning id into v_id;
  end if;
  update public.studios s
  set verification_status = case when s.verification_status = 'verified' then s.verification_status else 'pending' end
  where s.id = p_studio_id;
  return v_id;
end;
$$;

revoke all on function private.open_studio_verification(uuid, text, uuid[], uuid) from public, anon, authenticated;

-- El dueño pide la verificación (o completa la que abrió el registro).
create or replace function public.request_studio_verification(
  p_studio_id uuid,
  p_evidence text,
  p_contact_name text default null,
  p_contact_phone text default null,
  p_links text[] default '{}'::text[]
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_studio public.studios%rowtype;
  v_evidence text := nullif(pg_catalog.btrim(coalesce(p_evidence, '')), '');
  v_contact_name text := nullif(pg_catalog.btrim(coalesce(p_contact_name, '')), '');
  v_contact_phone text := nullif(pg_catalog.btrim(coalesce(p_contact_phone, '')), '');
  v_links text[];
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para verificar tu estudio.' using errcode = '42501';
  end if;
  select * into v_studio from public.studios s where s.id = p_studio_id for update;
  if not found or v_studio.user_id is distinct from v_uid then
    raise exception 'Solo el dueño del estudio puede pedir la verificación.' using errcode = '42501';
  end if;
  if v_studio.verification_status = 'verified' then
    raise exception 'Tu estudio ya está verificado.' using errcode = '23514';
  end if;
  if v_evidence is null or char_length(v_evidence) < 10 then
    raise exception 'Contanos cómo podemos verificar el estudio (mínimo 10 caracteres).' using errcode = '22023';
  end if;
  if char_length(v_evidence) > 2000 then
    raise exception 'La información admite hasta 2000 caracteres.' using errcode = '22023';
  end if;
  if (v_contact_name is not null and char_length(v_contact_name) > 160)
     or (v_contact_phone is not null and char_length(v_contact_phone) > 40) then
    raise exception 'Revisá el nombre y el teléfono de contacto.' using errcode = '22023';
  end if;
  select coalesce(pg_catalog.array_agg(distinct pg_catalog.btrim(x)), '{}'::text[]) into v_links
  from pg_catalog.unnest(coalesce(p_links, '{}'::text[])) x
  where pg_catalog.btrim(x) <> '';
  if pg_catalog.cardinality(v_links) > 5 then
    raise exception 'Podés sumar hasta 5 enlaces.' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.unnest(v_links) x
             where x !~* '^https?://[^\s/?#]+[^\s]*$' or char_length(x) > 500) then
    raise exception 'Los enlaces tienen que empezar con http:// o https://.' using errcode = '22023';
  end if;

  v_id := private.open_studio_verification(p_studio_id, 'owner_request', null, v_uid);
  update public.studio_verification_requests r
  set evidence = v_evidence,
      contact_name = v_contact_name,
      contact_phone = v_contact_phone,
      links = v_links,
      requested_by = coalesce(r.requested_by, v_uid),
      updated_at = timezone('utc', now())
  where r.id = v_id;
  return v_id;
end;
$$;

revoke all on function public.request_studio_verification(uuid, text, text, text, text[]) from public, anon;
grant execute on function public.request_studio_verification(uuid, text, text, text, text[]) to authenticated;

-- Soporte aprueba o rechaza.
create or replace function public.decide_studio_verification(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.studio_verification_requests%rowtype;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_now timestamptz := timezone('utc', now());
begin
  if not public.is_support_user() then
    raise exception 'Solo soporte de We Ötzi decide verificaciones.' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Decisión no válida.' using errcode = '22023';
  end if;
  if p_decision = 'reject' and (v_note is null or char_length(v_note) < 3) then
    raise exception 'Contale al estudio por qué no aprobamos la verificación.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'La nota admite hasta 1000 caracteres.' using errcode = '22023';
  end if;
  select * into v_request from public.studio_verification_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'Solicitud no encontrada.' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'La solicitud ya fue resuelta.' using errcode = '23514';
  end if;

  update public.studio_verification_requests r
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      decided_at = v_now, decided_by = auth.uid(), decision_note = v_note, updated_at = v_now
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

  return pg_catalog.jsonb_build_object('id', p_request_id, 'studio_id', v_request.studio_id,
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end);
end;
$$;

revoke all on function public.decide_studio_verification(uuid, text, text) from public, anon;
grant execute on function public.decide_studio_verification(uuid, text, text) to authenticated;

-- ===================== códigos de Instagram del estudio =====================
create table if not exists public.studio_instagram_verifications (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  ig_handle text not null,
  code_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'expired', 'cancelled', 'rejected')),
  email_sent_to text,
  email_sent boolean not null default false,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  verified_via text check (verified_via is null or verified_via in ('dm_webhook', 'support')),
  verified_by uuid,
  dm_sender_handle text,
  note text
);

create index if not exists studio_instagram_verifications_studio_idx
  on public.studio_instagram_verifications (studio_id, created_at desc);
create unique index if not exists studio_instagram_verifications_pending_code_idx
  on public.studio_instagram_verifications (code_hash) where status = 'pending';

alter table public.studio_instagram_verifications enable row level security;
revoke all on public.studio_instagram_verifications from anon, authenticated;
comment on table public.studio_instagram_verifications is
  'Códigos de validación de Instagram de estudios (solo service_role; guarda el hash, nunca el código).';

-- ===================== registro con coincidencias =====================
CREATE OR REPLACE FUNCTION private.complete_studio_registration(p_profile jsonb, p_locations jsonb)
 RETURNS studios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_studio public.studios; v_location jsonb; v_name text; v_slug text; v_email text;
  v_match record; v_matched uuid[] := '{}'; v_reason text; v_loc record; v_label text; v_dist double precision;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Confirmá tu correo e iniciá sesión para completar el registro.' USING ERRCODE = '42501'; END IF;
  -- Serializes retries from multiple tabs and prevents duplicate owned studios.
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  SELECT * INTO v_studio FROM public.studios WHERE user_id = auth.uid();
  IF FOUND THEN RETURN v_studio; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Confirmá tu correo antes de crear el estudio.'; END IF;
  v_name := nullif(btrim(p_profile->>'name'), '');
  IF v_name IS NULL OR length(v_name) < 2 OR length(v_name) > 160 THEN RAISE EXCEPTION 'El nombre debe tener entre 2 y 160 caracteres.'; END IF;
  -- Estudios M1: la ficha ya existe en el catálogo y no tiene dueño.
  IF EXISTS (SELECT 1 FROM public.studios WHERE normalized_name = upper(v_name) AND user_id IS NULL) THEN
    RAISE EXCEPTION 'Ese estudio ya está en We Ötzi: reclamalo desde el registro.' USING ERRCODE = '23514';
  END IF;
  -- Nombre idéntico a un estudio con dueño (UNIQUE normalized_name).
  IF EXISTS (SELECT 1 FROM public.studios WHERE normalized_name = upper(v_name)) THEN
    RAISE EXCEPTION 'Ya hay un estudio llamado «%» en We Ötzi. Si es el tuyo, iniciá sesión; si es otro, elegí un nombre que lo distinga (por ejemplo, sumá el barrio o la ciudad).', v_name USING ERRCODE = '23505';
  END IF;
  IF jsonb_typeof(p_locations) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Agregá al menos una sede.'; END IF;
  IF jsonb_array_length(p_locations) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Agregá entre 1 y 30 sedes.'; END IF;

  -- Coincidencias: ninguna sede puede compartir dirección con un estudio parecido.
  FOR v_match IN SELECT m.studio_id, m.match_kind, s.name FROM private.studio_matches(v_name, p_profile->>'instagram') m
                 JOIN public.studios s ON s.id = m.studio_id LOOP
    v_matched := v_matched || v_match.studio_id;
    v_reason := coalesce(v_reason, CASE WHEN v_match.match_kind = 'instagram' THEN 'instagram_match' ELSE 'name_match' END);
    FOR v_location IN SELECT value FROM jsonb_array_elements(p_locations) LOOP
      v_label := coalesce(nullif(btrim(v_location->>'label'), ''), 'tu sede');
      FOR v_loc IN
        SELECT l.formatted_address, l.latitude, l.longitude FROM public.studio_locations l
        WHERE l.studio_id = v_match.studio_id AND l.is_active IS NOT FALSE
        UNION ALL
        SELECT s.formatted_address, s.latitude, s.longitude FROM public.studios s WHERE s.id = v_match.studio_id
      LOOP
        v_dist := private.approx_distance_m(
          nullif(v_location->>'latitude', '')::double precision, nullif(v_location->>'longitude', '')::double precision,
          v_loc.latitude, v_loc.longitude);
        IF (v_dist IS NOT NULL AND v_dist < 40)
           OR (nullif(btrim(v_location->>'formatted_address'), '') IS NOT NULL
               AND private.studio_name_key(v_location->>'formatted_address') = private.studio_name_key(v_loc.formatted_address)) THEN
          RAISE EXCEPTION 'La dirección de % coincide con «%», que ya está en We Ötzi. Si es tu estudio, iniciá sesión o pedí la ficha; si es una sede de ese estudio, sumala desde su panel.', v_label, v_match.name
            USING ERRCODE = '23P01';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_slug := coalesce(nullif(v_slug, ''), 'estudio') || '-' || left(replace(auth.uid()::text, '-', ''), 8);
  INSERT INTO public.studios (user_id, email, name, normalized_name, slug, tagline, bio, founded_year, languages,
    instagram, whatsapp, website, contact_phone, cover_image, logo_image, photo_feed_items, is_active, profile_complete,
    verification_required, verification_reason)
  VALUES (auth.uid(), v_email, v_name, upper(v_name), v_slug, nullif(p_profile->>'tagline', ''), nullif(p_profile->>'bio', ''),
    nullif(p_profile->>'founded_year', '')::integer,
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_profile->'languages', '[]'::jsonb))),
    nullif(p_profile->>'instagram', ''), nullif(p_profile->>'whatsapp', ''), nullif(p_profile->>'website', ''),
    nullif(p_profile->>'contact_phone', ''), nullif(p_profile->>'cover_image', ''), nullif(p_profile->>'logo_image', ''),
    coalesce(p_profile->'photo_feed_items', '[]'::jsonb), true, false,
    cardinality(v_matched) > 0, v_reason)
  RETURNING * INTO v_studio;
  FOR v_location IN SELECT value FROM jsonb_array_elements(p_locations) LOOP
    PERFORM public.save_studio_location(v_studio.id, NULL, v_location);
  END LOOP;
  IF cardinality(v_matched) > 0 THEN
    PERFORM private.open_studio_verification(v_studio.id, v_reason, v_matched, auth.uid());
  END IF;
  SELECT * INTO v_studio FROM public.studios WHERE id = v_studio.id;
  RETURN v_studio;
END; $function$;

notify pgrst, 'reload schema';
commit;
