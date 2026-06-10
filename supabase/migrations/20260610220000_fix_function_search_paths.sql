-- Hardening: fija search_path en todas las funciones propias de la app que no
-- lo tenian (advisor "function_search_path_mutable"). Sin search_path fijo, una
-- funcion SECURITY DEFINER puede ser secuestrada creando objetos homonimos en
-- un esquema que el atacante controle.
--
-- Se excluyen las funciones que pertenecen a extensiones (pgvector instala
-- ~120 en public); esas las gestiona la extension.
-- Se usa "public, extensions" para no romper funciones que llamen a pgcrypto
-- u otras extensiones instaladas en el esquema extensions.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
      AND p.prokind = 'f'
      AND (p.proconfig IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'
      ))
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, extensions',
      r.nspname, r.proname, r.args
    );
  END LOOP;
END $$;
