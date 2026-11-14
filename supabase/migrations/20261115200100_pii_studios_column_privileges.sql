-- Beta cerrada · Marketplace MK-10 + Estudios ER-08: datos internos de studios.
--
-- Problema: las policies SELECT "Anyone can view studios" y
-- "studios_public_select" (qual true) más el GRANT SELECT de tabla dejan leer a
-- anon y a cualquier usuario con sesión TODAS las columnas de public.studios:
-- el email de acceso del dueño (private.complete_studio_registration lo copia
-- de auth.users), el teléfono interno de contacto, el motivo interno de
-- verificación, el handle verificado de Instagram, quién creó la ficha y las
-- condiciones comerciales del roster.
--
-- Qué hace (idempotente; no toca datos ni policies):
--   1. Privilegios por columna en studios: se revoca el SELECT de tabla a anon
--      y authenticated y se otorga SELECT sobre TODAS las columnas que existan
--      al aplicar, MENOS las privadas. RLS sigue decidiendo qué filas.
--        - Privadas para todos: email, contact_phone, verification_reason,
--          verification_required, instagram_verified_handle,
--          created_by_artist_user_id.
--        - Solo con sesión (authenticated): artist_requirements y
--          default_revenue_split_pct. Son las condiciones de trabajo que ve un
--          tatuador cuando un estudio lo invita (invitations-repo.js); no se
--          muestran a visitantes anónimos.
--      Columnas que se agreguen a studios DESPUÉS de esta migración no quedan
--      legibles por anon/authenticated hasta que otra migración las otorgue
--      (grant select (col) on public.studios to anon, authenticated).
--      INSERT/UPDATE no cambian (siguen gobernados por RLS).
--   2. public.get_my_studio(): security definer, fila COMPLETA del estudio del
--      dueño con sesión (o de cualquiera para soporte). studio-auth.js la usa
--      vía WeotziData.Studios.getByUserId(uid) cuando pide '*'.
--   3. save_studio_location / remove_studio_location hacen `SELECT * … FOR
--      UPDATE` sobre studios y corrían como el usuario: pasan a SECURITY
--      DEFINER (por ALTER, sin tocar el cuerpo vivo). Ya validan que
--      auth.uid() sea el dueño del estudio antes de escribir; se fija
--      search_path y se quita EXECUTE a anon.
--   (private.build_studio_contract_snapshot también hace select *, pero solo la
--    llama issue_studio_contract, que ya es security definer.)
--
-- Reversa: supabase/rollbacks/20261115200100_pii_studios_column_privileges.down.sql

-- 1) Privilegios por columna --------------------------------------------------

revoke select on table public.studios from anon, authenticated;

do $$
declare
  v_private text[] := array[
    'email', 'contact_phone', 'verification_reason', 'verification_required',
    'instagram_verified_handle', 'created_by_artist_user_id',
    'artist_requirements', 'default_revenue_split_pct'
  ];
  v_session_only text[] := array['artist_requirements', 'default_revenue_split_pct'];
  v_cols text;
  v_session_cols text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'studios'
     and not (c.column_name = any (v_private));

  if v_cols is null then
    raise exception 'pii-studios: no se encontró ninguna columna pública en studios';
  end if;

  execute format('grant select (%s) on public.studios to anon, authenticated', v_cols);

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_session_cols
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'studios'
     and c.column_name = any (v_session_only);

  if v_session_cols is not null then
    execute format('grant select (%s) on public.studios to authenticated', v_session_cols);
  end if;
end;
$$;

grant all on table public.studios to service_role;

-- 2) Fila completa del propio estudio -----------------------------------------

create or replace function public.get_my_studio()
returns setof public.studios
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
    from public.studios s
   where (select auth.uid()) is not null
     and (s.user_id = (select auth.uid()) or public.is_support_user());
$$;

comment on function public.get_my_studio() is
  'pii-studios: fila completa (incluye email del dueño y datos internos) SOLO del estudio de la cuenta con sesión; soporte ve todas. Admite select= y filtros de PostgREST.';

revoke all on function public.get_my_studio() from public, anon;
grant execute on function public.get_my_studio() to authenticated, service_role;

-- 3) Funciones invoker que leen la fila completa ------------------------------

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('save_studio_location', 'remove_studio_location')
  loop
    execute format('alter function %s security definer', r.fn);
    execute format('alter function %s set search_path = public, pg_temp', r.fn);
    execute format('revoke all on function %s from public, anon', r.fn);
    execute format('grant execute on function %s to authenticated, service_role', r.fn);
  end loop;
end;
$$;
