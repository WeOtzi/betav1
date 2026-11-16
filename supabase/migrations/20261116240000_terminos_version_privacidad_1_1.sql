-- ============================================================================
-- Versión legal que sella handle_new_user: 2026-11-13 → 2026-11-16
-- ============================================================================
-- La Política de privacidad pasó a la versión 1.1 (16 nov 2026): la fila de
-- OpenAI declara también el asistente automático del chat de soporte. El
-- código de versión que se guarda al aceptar los Términos y la Política es uno
-- solo para el par de textos y vive en tres lugares que se suben a la vez:
--
--   - lib/terms-acceptance.js → TERMS_VERSION (artistas y clientes con Google
--     o Facebook, que sella el servidor);
--   - public/shared/js/studio-register.js → TERMS_VERSION (estudios);
--   - public.handle_new_user() → current_terms_version (clientes que se
--     registran con email): es lo que cambia esta migración.
--
-- handle_new_user vive en la base con una definición que difiere del repo
-- (ver 20261115100000). Por eso no se reescribe la función a mano: se toma la
-- definición VIVA con pg_get_functiondef y se cambia solo la constante. Todo
-- lo demás (superadmin, ramas por tipo de alta, enlace de cotizaciones por
-- email, security definer, search_path) queda byte por byte como está.
--
-- Efecto: solo cambia la versión que se sella en las altas NUEVAS. Quien ya
-- aceptó conserva la versión que aceptó (2026-11-13): nadie tiene que volver
-- a aceptar ni queda bloqueado.
--
-- Se puede volver a correr: si la función ya sella 2026-11-16, no hace nada.
-- Si no encuentra la constante esperada, falla sin tocar nada.
-- Reversa: supabase/rollbacks/20261116240000_terminos_version_privacidad_1_1.down.sql
-- ============================================================================

begin;

do $mig$
declare
  def text;
  viejo constant text := $q$current_terms_version constant text := '2026-11-13'$q$;
  nuevo constant text := $q$current_terms_version constant text := '2026-11-16'$q$;
begin
  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into def;

  if position(nuevo in def) > 0 then
    raise notice 'handle_new_user ya sella la versión 2026-11-16: nada que hacer';
    return;
  end if;

  if position(viejo in def) = 0 then
    raise exception 'handle_new_user no tiene la constante de versión esperada (2026-11-13): revisar la definición viva antes de aplicar';
  end if;

  execute replace(def, viejo, nuevo);
end
$mig$;

commit;
