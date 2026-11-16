-- Reversa de 20261116240000_terminos_version_privacidad_1_1.sql
-- handle_new_user vuelve a sellar la versión legal 2026-11-13. Igual que la
-- migración, toma la definición viva y cambia solo la constante. Las filas que
-- ya se sellaron con 2026-11-16 no se tocan: registran lo que esa persona
-- aceptó de verdad. Volver también lib/terms-acceptance.js y
-- public/shared/js/studio-register.js a '2026-11-13'.

begin;

do $mig$
declare
  def text;
  nuevo constant text := $q$current_terms_version constant text := '2026-11-16'$q$;
  viejo constant text := $q$current_terms_version constant text := '2026-11-13'$q$;
begin
  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into def;

  if position(viejo in def) > 0 then
    raise notice 'handle_new_user ya sella la versión 2026-11-13: nada que hacer';
    return;
  end if;

  if position(nuevo in def) = 0 then
    raise exception 'handle_new_user no tiene la constante de versión esperada (2026-11-16): revisar la definición viva antes de revertir';
  end if;

  execute replace(def, nuevo, viejo);
end
$mig$;

commit;
