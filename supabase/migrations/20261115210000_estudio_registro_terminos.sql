-- Registro de estudios · Términos y Privacidad (beta cerrada, 15 nov 2026).
--
-- Hallazgo ER-06: el registro de estudios no pedía aceptar los Términos y la
-- Política de Privacidad. Esta migración:
--   1. Agrega studios.terms_accepted_at / terms_version y las mismas columnas en
--      studio_claim_requests (quien reclama una ficha también acepta).
--   2. Protege esas columnas: solo las escriben las RPC del registro (SECURITY
--      DEFINER) o service-role. Trigger propio (no toca
--      private.guard_studio_protected_columns, que es del frente de verificación).
--   3. public.complete_studio_registration pasa a exigir
--      p_profile->>'terms_accepted' = 'true' cuando la cuenta todavía no tiene
--      estudio, y sella fecha y versión. Sigue delegando en
--      private.complete_studio_registration / private.claim_studio_with_link sin
--      cambiarlas. Pasa a SECURITY DEFINER (solo despacha: las funciones privadas
--      validan auth.uid()) para poder sellar las columnas protegidas.
--   4. public.request_studio_claim(…, p_terms_version) — sobrecarga de 5
--      argumentos que exige la aceptación y la guarda en el reclamo. La versión
--      de 4 argumentos queda para clientes viejos durante el deploy.
--   5. Al aprobar un reclamo (status → approved), la aceptación del reclamo se
--      copia al estudio.
--
-- Idempotente. Reversa: supabase/rollbacks/20261115210000_estudio_registro_terminos.down.sql

begin;

-- 1. Columnas -----------------------------------------------------------------
alter table public.studios
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

alter table public.studio_claim_requests
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

comment on column public.studios.terms_accepted_at is
  'Cuándo el dueño aceptó los Términos y la Política de Privacidad (registro o reclamo aprobado).';
comment on column public.studios.terms_version is
  'Versión de los Términos aceptada (lib/terms-acceptance.js TERMS_VERSION).';

-- 2. Guard de las columnas de términos -----------------------------------------
create or replace function private.guard_studio_terms_columns()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.terms_accepted_at := null;
    new.terms_version := null;
    return new;
  end if;
  if new.terms_accepted_at is distinct from old.terms_accepted_at
     or new.terms_version is distinct from old.terms_version then
    raise exception 'La aceptación de los Términos se registra solo desde el alta del estudio.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_studio_terms_columns on public.studios;
create trigger trg_guard_studio_terms_columns
  before insert or update on public.studios
  for each row execute function private.guard_studio_terms_columns();

-- 3. Alta con aceptación obligatoria -------------------------------------------
create or replace function public.complete_studio_registration(p_profile jsonb, p_locations jsonb)
returns public.studios
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_token text := nullif(btrim(coalesce(p_profile->>'claim_token', '')), '');
  v_version text := left(nullif(btrim(coalesce(p_profile->>'terms_version', '')), ''), 40);
  v_result public.studios;
begin
  if v_uid is null then
    raise exception 'Confirmá tu correo e iniciá sesión para completar el registro.' using errcode = '42501';
  end if;
  -- Una cuenta que ya tiene estudio recibe el suyo (reintentos idempotentes).
  if not exists (select 1 from public.studios s where s.user_id = v_uid)
     and coalesce(p_profile->>'terms_accepted', '') <> 'true' then
    raise exception 'Aceptá los Términos y la Política de Privacidad para crear el estudio.'
      using errcode = '22023', hint = 'terms_required';
  end if;

  if v_token is not null then
    v_result := private.claim_studio_with_link(v_token, p_profile - 'claim_token', p_locations);
  else
    v_result := private.complete_studio_registration(p_profile, p_locations);
  end if;

  if coalesce(p_profile->>'terms_accepted', '') = 'true' then
    update public.studios s
       set terms_accepted_at = now(),
           terms_version = coalesce(v_version, 'sin-version')
     where s.id = v_result.id
       and s.user_id = v_uid
       and s.terms_accepted_at is null;
    select * into v_result from public.studios s where s.id = v_result.id;
  end if;
  return v_result;
end;
$function$;

revoke all on function public.complete_studio_registration(jsonb, jsonb) from public, anon;
grant execute on function public.complete_studio_registration(jsonb, jsonb) to authenticated, service_role;

-- 4. Reclamo con aceptación ------------------------------------------------------
create or replace function public.request_studio_claim(
  p_studio_id uuid,
  p_evidence text,
  p_contact_name text,
  p_contact_phone text,
  p_terms_version text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_version text := left(nullif(btrim(coalesce(p_terms_version, '')), ''), 40);
  v_id uuid;
begin
  if v_version is null then
    raise exception 'Aceptá los Términos y la Política de Privacidad para reclamar el estudio.'
      using errcode = '22023', hint = 'terms_required';
  end if;
  v_id := public.request_studio_claim(p_studio_id, p_evidence, p_contact_name, p_contact_phone);
  update public.studio_claim_requests c
     set terms_accepted_at = coalesce(c.terms_accepted_at, timezone('utc', now())),
         terms_version = coalesce(c.terms_version, v_version)
   where c.id = v_id;
  return v_id;
end;
$function$;

revoke all on function public.request_studio_claim(uuid, text, text, text, text) from public, anon;
grant execute on function public.request_studio_claim(uuid, text, text, text, text) to authenticated, service_role;

-- 5. Reclamo aprobado → aceptación al estudio ------------------------------------
create or replace function private.copy_claim_terms_to_studio()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.terms_accepted_at is not null then
    update public.studios s
       set terms_accepted_at = new.terms_accepted_at,
           terms_version = new.terms_version
     where s.id = new.studio_id
       and s.user_id = new.user_id
       and s.terms_accepted_at is null;
  end if;
  return new;
end;
$function$;

revoke all on function private.copy_claim_terms_to_studio() from public, anon, authenticated;

drop trigger if exists trg_copy_claim_terms_to_studio on public.studio_claim_requests;
create trigger trg_copy_claim_terms_to_studio
  after update of status on public.studio_claim_requests
  for each row execute function private.copy_claim_terms_to_studio();

commit;
