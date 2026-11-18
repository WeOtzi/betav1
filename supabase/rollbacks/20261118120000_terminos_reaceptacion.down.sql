-- Reversa de 20261118120000_terminos_reaceptacion.sql
-- - Borra public.terms_reentry_pending y public.terms_reentry_checks (barrido
--   del bloqueo de reingreso y excepciones de soporte: las cuentas con
--   cleared_at pierden la excepción y vuelven a pasar por la comprobación).
-- - Borra public.terms_acceptances (se pierde el registro de quién re-aceptó;
--   las columnas terms_* de cada perfil conservan la última aceptación).
-- - handle_new_user vuelve a sellar 2026-11-16 (definición viva + replace).
-- - complete_studio_registration vuelve a la definición viva anterior
--   (versión del navegador y mensajes originales).
-- Volver también lib/terms-acceptance.js y public/shared/js/studio-register.js
-- a '2026-11-16'. Las filas ya selladas con 2026-11-18 no se tocan: registran
-- lo que esa persona aceptó de verdad.

begin;

drop function if exists public.terms_reentry_pending(timestamptz, integer);
drop table if exists public.terms_reentry_checks;
drop table if exists public.terms_acceptances;

do $mig$
declare
  def text;
  nuevo constant text := $q$current_terms_version constant text := '2026-11-18'$q$;
  viejo constant text := $q$current_terms_version constant text := '2026-11-16'$q$;
begin
  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into def;

  if position(viejo in def) > 0 then
    raise notice 'handle_new_user ya sella la versión 2026-11-16: nada que hacer';
    return;
  end if;

  if position(nuevo in def) = 0 then
    raise exception 'handle_new_user no tiene la constante de versión esperada (2026-11-18): revisar la definición viva antes de revertir';
  end if;

  execute replace(def, nuevo, viejo);
end
$mig$;

create or replace function public.complete_studio_registration(p_profile jsonb, p_locations jsonb)
 returns studios
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

commit;
