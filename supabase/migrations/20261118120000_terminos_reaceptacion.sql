-- ============================================================================
-- Re-aceptación de Términos (2.7.0 · identidad, suplantación y plagio)
-- ============================================================================
-- Decisión del dueño (2026-11-18): todas las personas (artista, cliente,
-- estudio) vuelven a aceptar los Términos y la Política de privacidad al
-- iniciar sesión. Versión legal nueva: 2026-11-18 (Términos v1.1 y Privacidad
-- v1.2). Esta migración:
--
--   1. Crea public.terms_acceptances: una fila por persona y versión aceptada.
--      Es la fuente de verdad del gate (GET /api/account/terms-status). Las
--      columnas terms_accepted_at / terms_version de artists_db, clients_db y
--      studios se mantienen por compatibilidad y el servidor las vuelve a
--      sellar en cada aceptación (POST /api/account/terms-accept).
--      Solo escribe el servidor (service_role). Invariante: el servidor
--      inserta una fila recién después de comprobar el bloqueo de reingreso
--      (lib/sanciones-service.checkReentry); por eso ni handle_new_user ni
--      complete_studio_registration escriben aquí.
--   2. Sube la constante de handle_new_user de 2026-11-16 a 2026-11-18 a
--      partir de la definición VIVA (mismo patrón que 20261116240000): si no
--      encuentra la constante esperada, falla sin tocar nada.
--   3. complete_studio_registration deja de copiar la versión que manda el
--      navegador (el campo terms_version del perfil): sella la constante del
--      servidor. Los mensajes de error pasan a tuteo. El cuerpo parte de la
--      definición viva (pg_get_functiondef, 2026-11-18) con solo esos cambios.
--   4. Barrido del bloqueo de reingreso: public.terms_reentry_checks y la RPC
--      public.terms_reentry_pending (solo service_role), para revisar en el
--      servidor las altas de cliente y estudio sin depender del navegador.
--      terms_reentry_checks guarda también la excepción de soporte
--      (cleared_at): una cuenta cuyo cierre levantó soporte, o cuya alerta de
--      reingreso descartó, ya no se bloquea por coincidir con otra cuenta
--      sancionada. Las huellas de esa otra cuenta siguen bloqueando a todos.
--
-- Mantener la versión igual en: lib/terms-acceptance.js (TERMS_VERSION),
-- public/shared/js/studio-register.js y estas dos funciones.
-- Reversa: supabase/rollbacks/20261118120000_terminos_reaceptacion.down.sql
-- ============================================================================

begin;

-- ── 1. terms_acceptances ────────────────────────────────────────────────────
create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null check (char_length(version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  surface text not null default 'gate'
    check (surface in ('artist', 'client', 'studio', 'signup', 'gate')),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  constraint terms_acceptances_user_version_key unique (user_id, version)
);

comment on table public.terms_acceptances is
  'Aceptaciones de Términos y Privacidad por persona y versión. Solo escribe el servidor (service_role), después de comprobar el bloqueo de reingreso.';

alter table public.terms_acceptances enable row level security;

drop policy if exists terms_acceptances_select_own on public.terms_acceptances;
create policy terms_acceptances_select_own on public.terms_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.terms_acceptances from public, anon, authenticated;
grant select on table public.terms_acceptances to authenticated;
grant all on table public.terms_acceptances to service_role;

-- ── 2. handle_new_user: constante 2026-11-16 → 2026-11-18 ───────────────────
do $mig$
declare
  def text;
  viejo constant text := $q$current_terms_version constant text := '2026-11-16'$q$;
  nuevo constant text := $q$current_terms_version constant text := '2026-11-18'$q$;
begin
  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into def;

  if position(nuevo in def) > 0 then
    raise notice 'handle_new_user ya sella la versión 2026-11-18: nada que hacer';
    return;
  end if;

  if position(viejo in def) = 0 then
    raise exception 'handle_new_user no tiene la constante de versión esperada (2026-11-16): revisar la definición viva antes de aplicar';
  end if;

  execute replace(def, viejo, nuevo);
end
$mig$;

-- ── 3. complete_studio_registration: versión del servidor y tuteo ───────────
create or replace function public.complete_studio_registration(p_profile jsonb, p_locations jsonb)
 returns studios
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_token text := nullif(btrim(coalesce(p_profile->>'claim_token', '')), '');
  -- Versión legal vigente (lib/terms-acceptance.js TERMS_VERSION). Ya no se
  -- copia la que manda el navegador.
  v_version constant text := '2026-11-18';
  v_result public.studios;
begin
  if v_uid is null then
    raise exception 'Confirma tu correo e inicia sesión para completar el registro.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.studios s where s.user_id = v_uid)
     and coalesce(p_profile->>'terms_accepted', '') <> 'true' then
    raise exception 'Acepta los Términos y la Política de Privacidad para crear el estudio.'
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
           terms_version = v_version
     where s.id = v_result.id
       and s.user_id = v_uid
       and s.terms_accepted_at is null;
    select * into v_result from public.studios s where s.id = v_result.id;
  end if;
  return v_result;
end;
$function$;

-- ── 4. Barrido del bloqueo de reingreso ─────────────────────────────────────
-- Las altas de cliente (trigger handle_new_user) y de estudio (RPC desde el
-- navegador) no pasan por el servidor. El servidor las revisa con un barrido
-- periódico (lib/routes/terminos.js) que no depende del navegador:
--   * public.terms_reentry_checks: una fila por cuenta ya revisada. Con
--     cleared_at, la cuenta tiene la excepción de soporte: la escribe el
--     servidor al levantar un cierre (lib/sanciones-service.liftSanction, vía
--     soporte o apelación) o al descartar una alerta de reingreso de esa
--     cuenta. checkReentry deja de bloquearla por las huellas de OTRA cuenta
--     (inicio de sesión, barrido, modo cliente, validación de Instagram).
--   * public.terms_reentry_pending(p_since, p_limit): cuentas creadas desde
--     p_since (y hace más de 5 minutos), sin ban vigente, sin ninguna fila en
--     terms_acceptances, sin excepción de soporte y sin revisión posterior a
--     su último perfil de cliente o estudio (un estudio creado después de la
--     revisión se vuelve a revisar).
-- Solo service_role.
create table if not exists public.terms_reentry_checks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  checked_at timestamptz not null default now(),
  blocked boolean not null default false,
  -- Excepción de soporte (null = sin excepción). cleared_by: agente que
  -- levantó la sanción o descartó la alerta; cleared_sanction_id /
  -- cleared_alert_id: de dónde salió. Sin FK: es un registro de auditoría.
  cleared_at timestamptz,
  cleared_by uuid,
  cleared_sanction_id uuid,
  cleared_alert_id uuid,
  constraint terms_reentry_checks_cleared_check
    check (cleared_at is not null or (cleared_by is null and cleared_sanction_id is null and cleared_alert_id is null))
);

comment on table public.terms_reentry_checks is
  'Cuentas que el barrido del bloqueo de reingreso ya revisó y excepciones de soporte (cleared_at). Solo escribe el servidor (service_role).';
comment on column public.terms_reentry_checks.cleared_at is
  'Excepción de soporte: la cuenta ya no se bloquea por coincidir con las huellas de otra cuenta sancionada. Las huellas siguen bloqueando a cualquier otra cuenta.';

alter table public.terms_reentry_checks enable row level security;
revoke all on table public.terms_reentry_checks from public, anon, authenticated;
grant all on table public.terms_reentry_checks to service_role;

create or replace function public.terms_reentry_pending(p_since timestamptz, p_limit integer default 50)
 returns table (user_id uuid, email text, phone text, created_at timestamptz, user_metadata jsonb)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select u.id,
         u.email::text,
         u.phone::text,
         u.created_at,
         jsonb_strip_nulls(jsonb_build_object(
           'instagram', u.raw_user_meta_data->>'instagram',
           'whatsapp', u.raw_user_meta_data->>'whatsapp'
         ))
    from auth.users u
   where u.created_at >= p_since
     and u.created_at <= now() - interval '5 minutes'
     and u.deleted_at is null
     and (u.banned_until is null or u.banned_until <= now())
     and not exists (select 1 from public.terms_acceptances ta where ta.user_id = u.id)
     and not exists (
       select 1
         from public.terms_reentry_checks rc
        where rc.user_id = u.id
          and (rc.cleared_at is not null
           or rc.checked_at >= greatest(
                coalesce((select max(s.created_at) from public.studios s where s.user_id = u.id), '-infinity'::timestamptz),
                coalesce((select max(c.created_at) from public.clients_db c where c.user_id = u.id), '-infinity'::timestamptz)
              ))
     )
   order by u.created_at
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$function$;

comment on function public.terms_reentry_pending(timestamptz, integer) is
  'Cuentas nuevas pendientes de revisar contra los identificadores baneados (barrido de lib/routes/terminos.js). Solo service_role.';

revoke all on function public.terms_reentry_pending(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.terms_reentry_pending(timestamptz, integer) to service_role;

commit;
