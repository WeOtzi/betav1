-- Reversa de 20261115200100_pii_studios_column_privileges.sql.
-- ATENCIÓN: vuelve a exponer TODAS las columnas de studios (email del dueño,
-- teléfono interno, motivo de verificación, condiciones del roster) a anon y
-- authenticated. Solo para volver atrás si la migración rompe algo.

-- 1) Privilegios: SELECT de tabla otra vez (se limpian los grants por columna).
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'studios';
  if v_cols is not null then
    execute format('revoke select (%s) on public.studios from anon, authenticated', v_cols);
  end if;
end;
$$;
grant select on table public.studios to anon, authenticated;

-- 2) RPC. studios-repo.js (getByUserId con '*') la usa: si se revierte sin
--    revertir el código, studios-repo cae a la lectura directa de la tabla.
drop function if exists public.get_my_studio();

-- 3) Funciones de sedes: vuelven a SECURITY INVOKER (estado previo).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('save_studio_location', 'remove_studio_location')
  loop
    execute format('alter function %s security invoker', r.fn);
    execute format('grant execute on function %s to authenticated, service_role', r.fn);
  end loop;
end;
$$;
