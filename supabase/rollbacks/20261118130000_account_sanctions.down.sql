-- Reversa de 20261118130000_account_sanctions.sql (sanciones de cuenta).
--
-- Orden: primero se devuelven vistas, funciones y políticas a su versión sin
-- artist_is_public ni sanction_state (reemplazos inversos sobre la definición
-- VIVA, como en 20261117130000_flash_tattoos.down.sql: así no se pisan cambios
-- de otras migraciones posteriores); después se borran triggers, funciones,
-- tablas y columnas nuevas.
--
-- Definiciones previas (vivas al 2026-11-18), para referencia:
--   - políticas "Public can view artists for marketplace" y "Authenticated can
--     view all artists for marketplace": for select, to public,
--     using (registration_status IS DISTINCT FROM 'incompleto'::text);
--   - artists_with_location y public_artist_trips: WHERE …
--     a.registration_status IS DISTINCT FROM 'incompleto'::text
--     (security_barrier = true);
--   - get_artist_public_badges, get_public_storefront, create_store_order,
--     store_public_seller_bundle, store_seller_ready_artist,
--     recalculate_most_wanted: a.registration_status is distinct from 'incompleto';
--   - request_artist_wallet_withdrawal: sin el bloque de sanción antes de la
--     validación de monto;
--   - quotation_payments_wallet_feed: when 'deposit' then 'Seña recibida'.
--   - get_public_storefront y store_public_seller_bundle (rama estudio):
--     and s.is_active;
--   - create_store_order: sin la condición del estudio oculto
--     (private.studio_is_listed) en la validación de vendedor;
--   - política spots_public_select_open de studio_spots: for select, to
--     public, using (status = 'open'::text);
--   - artists_with_location: LEFT JOIN studios s ON a.studio_id = s.id AND
--     (a.work_type = ANY (ARRAY['studio'::text, 'both'::text])).
--
-- Se pierden las sanciones, las huellas de reingreso y las alertas de
-- seguridad guardadas. Los motivos de cierre por soporte de cotizaciones
-- también (las cotizaciones siguen canceladas).

begin;

-- 0. Estudios: la tienda vuelve a «s.is_active», create_store_order sin la
--    condición del estudio oculto, la política de spots y la unión de
--    artists_with_location como estaban; después se borran los predicados.
--    Va primero: los pasos 3 y 4 fallan si queda sanction_state con otro texto.
do $rollback$
declare
  v_def text;
  v_cond_a constant text := $q$ AND public.studio_is_public(s.is_active, s.sanction_state)$q$;
  v_cond_b constant text := $q$ AND studio_is_public(s.is_active, s.sanction_state)$q$;
begin
  v_def := pg_get_viewdef('public.artists_with_location'::regclass, true);
  if position('studio_is_public' in v_def) = 0 then
    raise notice 'artists_with_location no usa studio_is_public: nada que hacer';
    return;
  end if;
  v_def := replace(replace(v_def, v_cond_a, ''), v_cond_b, '');
  if position('studio_is_public' in v_def) > 0 then
    raise exception 'artists_with_location usa studio_is_public con otro texto: revisar a mano';
  end if;
  v_def := rtrim(v_def, E'; \n');
  execute format('create or replace view public.artists_with_location with (security_barrier = true) as %s', v_def);
end
$rollback$;

do $rollback$
declare
  v_fn text;
  v_def text;
  v_new constant text := $q$and public.studio_is_public(s.is_active, s.sanction_state)$q$;
  v_old constant text := $q$and s.is_active$q$;
begin
  foreach v_fn in array array[
    'public.get_public_storefront(text,text)',
    'public.store_public_seller_bundle(text,uuid)'
  ] loop
    if to_regprocedure(v_fn) is null then
      continue;
    end if;
    v_def := pg_get_functiondef(to_regprocedure(v_fn));
    if position(v_new in v_def) > 0 then
      execute replace(v_def, v_new, v_old);
    elsif position('studio_is_public' in v_def) > 0 then
      raise exception '%: usa studio_is_public con otro texto: revisar a mano', v_fn;
    end if;
  end loop;
end
$rollback$;

do $rollback$
declare
  v_def text;
  v_new constant text := $q$(v_product.seller_type = 'artist' and not public.store_seller_ready_artist(v_product.seller_id))
     or (v_product.seller_type = 'studio' and not private.studio_is_listed(v_product.seller_id)) then$q$;
  v_old constant text := $q$(v_product.seller_type = 'artist' and not public.store_seller_ready_artist(v_product.seller_id)) then$q$;
begin
  v_def := pg_get_functiondef('public.create_store_order(uuid,uuid,integer,text,text,text,jsonb,text,text,text)'::regprocedure);
  if position(v_new in v_def) > 0 then
    execute replace(v_def, v_new, v_old);
  elsif position('studio_is_listed' in v_def) > 0 then
    raise exception 'create_store_order revisa el estudio con otro texto: revisar a mano';
  end if;
end
$rollback$;

drop policy if exists spots_public_select_open on public.studio_spots;
create policy spots_public_select_open
  on public.studio_spots for select
  using (status = 'open'::text);

drop function if exists private.studio_is_listed(uuid);
drop function if exists public.studio_is_public(boolean, text);

-- 1. Retiros: sin el bloque de sanción.
do $rollback$
declare
  v_def text;
  v_guard constant text := E'  -- Sanción activa (suspensión o baneo): sin retiros hasta que soporte la levante.\n'
    || E'  if exists (\n'
    || E'    select 1 from public.account_sanctions s\n'
    || E'     where s.user_id = v_user_id\n'
    || E'       and s.kind in (''suspension'', ''ban'')\n'
    || E'       and s.status in (''active'', ''appealed'')\n'
    || E'  ) then\n'
    || E'    raise exception ''Tu cuenta tiene una sanción activa: no puedes solicitar retiros por ahora.'' using errcode = ''42501'';\n'
    || E'  end if;\n';
begin
  v_def := pg_get_functiondef('public.request_artist_wallet_withdrawal(uuid,numeric,text)'::regprocedure);
  if position(v_guard in v_def) = 0 then
    if position('account_sanctions' in v_def) > 0 then
      raise exception 'request_artist_wallet_withdrawal revisa sanciones con otro texto: revisar a mano antes de borrar account_sanctions';
    end if;
    raise notice 'request_artist_wallet_withdrawal no tiene el bloque de sanción: nada que hacer';
  else
    execute replace(v_def, v_guard, '');
  end if;
end
$rollback$;

-- 2. Etiqueta del anticipo: vuelve la versión anterior.
do $rollback$
declare
  v_def text;
  v_new constant text := $q$when 'deposit' then 'Anticipo recibido'$q$;
  v_old constant text := $q$when 'deposit' then 'Seña recibida'$q$;
begin
  v_def := pg_get_functiondef('public.quotation_payments_wallet_feed()'::regprocedure);
  if position(v_new in v_def) > 0 then
    execute replace(v_def, v_new, v_old);
  else
    raise notice 'quotation_payments_wallet_feed no tiene «Anticipo recibido»: nada que hacer';
  end if;
end
$rollback$;

-- 3. Funciones SECURITY DEFINER: vuelven al filtro 'incompleto'.
do $rollback$
declare
  v_fn text;
  v_def text;
  v_new constant text := $q$public.artist_is_public(a.registration_status, a.sanction_state)$q$;
  v_old constant text := $q$a.registration_status is distinct from 'incompleto'$q$;
begin
  foreach v_fn in array array[
    'public.get_artist_public_badges(uuid)',
    'public.get_public_storefront(text,text)',
    'public.create_store_order(uuid,uuid,integer,text,text,text,jsonb,text,text,text)',
    'public.store_public_seller_bundle(text,uuid)',
    'public.store_seller_ready_artist(uuid)',
    'public.recalculate_most_wanted(integer,integer)'
  ] loop
    if to_regprocedure(v_fn) is null then
      continue;
    end if;
    v_def := pg_get_functiondef(to_regprocedure(v_fn));
    if position(v_new in v_def) > 0 then
      execute replace(v_def, v_new, v_old);
    elsif position('artist_is_public' in v_def) > 0 or position('sanction_state' in v_def) > 0 then
      raise exception '%: usa artist_is_public o sanction_state con otro texto: revisar a mano', v_fn;
    end if;
  end loop;
end
$rollback$;

-- 4. Vistas: vuelven al filtro 'incompleto'.
do $rollback$
declare
  v_view text;
  v_def text;
  v_new constant text := $q$artist_is_public(a.registration_status, a.sanction_state)$q$;
  v_old constant text := $q$a.registration_status IS DISTINCT FROM 'incompleto'::text$q$;
begin
  foreach v_view in array array['artists_with_location', 'public_artist_trips'] loop
    v_def := pg_get_viewdef(format('public.%I', v_view)::regclass, true);
    if position(v_new in v_def) = 0 then
      if position('sanction_state' in v_def) > 0 then
        raise exception '%: usa sanction_state con otro texto: revisar a mano', v_view;
      end if;
      continue;
    end if;
    -- pg_get_viewdef puede o no calificar la función con public.
    v_def := replace(v_def, 'public.' || v_new, v_new);
    v_def := rtrim(replace(v_def, v_new, v_old), E'; \n');
    execute format('create or replace view public.%I with (security_barrier = true) as %s', v_view, v_def);
  end loop;
end
$rollback$;

-- 5. Políticas públicas de artists_db: sin sanction_state.
drop policy if exists "Public can view artists for marketplace" on public.artists_db;
create policy "Public can view artists for marketplace"
  on public.artists_db for select
  using (registration_status is distinct from 'incompleto'::text);

drop policy if exists "Authenticated can view all artists for marketplace" on public.artists_db;
create policy "Authenticated can view all artists for marketplace"
  on public.artists_db for select
  using (registration_status is distinct from 'incompleto'::text);

-- 6. Sesiones.
drop function if exists public.revoke_user_sessions(uuid);
drop function if exists private.revoke_user_sessions(uuid);

-- 7. Guardas.
drop trigger if exists trg_guard_artist_sanction_columns on public.artists_db;
drop trigger if exists trg_guard_studio_sanction_columns on public.studios;
drop trigger if exists trg_guard_quotation_support_closed_reason on public.quotations_db;
drop function if exists private.guard_artist_sanction_columns();
drop function if exists private.guard_studio_sanction_columns();
drop function if exists private.guard_quotation_support_closed_reason();

-- 8. Tablas.
drop table if exists public.security_alerts;
drop table if exists public.banned_identifiers;
drop table if exists public.account_sanctions;

-- 9. Columnas.
alter table public.quotations_db drop constraint if exists quotations_db_support_closed_reason_check;
alter table public.quotations_db drop column if exists support_closed_reason;
alter table public.studios drop constraint if exists studios_sanction_state_check;
alter table public.studios drop column if exists sanction_id;
alter table public.studios drop column if exists sanction_state;
alter table public.artists_db drop constraint if exists artists_db_sanction_state_check;
alter table public.artists_db drop column if exists sanction_id;
alter table public.artists_db drop column if exists sanction_state;

-- 10. Predicado.
drop function if exists public.artist_is_public(text, text);

commit;
