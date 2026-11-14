-- Reversa de 20261115210000_estudio_registro_terminos.sql.
-- Vuelve public.complete_studio_registration a la definición previa (SECURITY
-- INVOKER, sin exigir términos), quita la sobrecarga de request_studio_claim y
-- los triggers. Las columnas de aceptación se conservan a propósito (registro
-- legal); para borrarlas descomentar el bloque final.

begin;

drop trigger if exists trg_copy_claim_terms_to_studio on public.studio_claim_requests;
drop function if exists private.copy_claim_terms_to_studio();

drop function if exists public.request_studio_claim(uuid, text, text, text, text);

create or replace function public.complete_studio_registration(p_profile jsonb, p_locations jsonb)
returns public.studios
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_token text := nullif(btrim(coalesce(p_profile->>'claim_token', '')), '');
BEGIN
  IF v_token IS NOT NULL THEN
    RETURN private.claim_studio_with_link(v_token, p_profile - 'claim_token', p_locations);
  END IF;
  RETURN private.complete_studio_registration(p_profile, p_locations);
END;
$function$;

revoke all on function public.complete_studio_registration(jsonb, jsonb) from public, anon;
grant execute on function public.complete_studio_registration(jsonb, jsonb) to authenticated, service_role;

drop trigger if exists trg_guard_studio_terms_columns on public.studios;
drop function if exists private.guard_studio_terms_columns();

-- alter table public.studios drop column if exists terms_accepted_at, drop column if exists terms_version;
-- alter table public.studio_claim_requests drop column if exists terms_accepted_at, drop column if exists terms_version;

commit;
