-- Reversa de 20261118100000_insignia_instagram.sql
-- Las funciones vuelven a su definición anterior con el mismo método que la
-- migración (definición viva + replace() del texto agregado). Después se
-- quitan las columnas generadas y la función de la regla. La insignia vuelve a
-- salir solo de verification_state = 'Yes' / is_verified, y 'verified' de
-- get_artist_public_profile_preferences recupera la rama del documento de
-- identidad aprobado y la cola de soporte deja de traer instagram e
-- instagram_badge_ok. Volver también el código que lee instagram_badge_ok
-- (public/shared/js/verified-badge.js cae al cálculo por handle si la columna
-- no viene en la fila).
-- Se puede volver a correr: cada paso comprueba si ya está revertido (funciones
-- por marcador, permisos de columna solo si la columna existe, drop … if exists).

begin;

-- support_list_verification_requests vuelve a no devolver instagram ni
-- instagram_badge_ok (se borra y se recrea con los mismos permisos).
do $mig$
declare
  def text;
  ret_new constant text := 'instagram_verified_handle text, instagram text, instagram_badge_ok boolean, requested_at timestamp with time zone';
  ret_old constant text := 'instagram_verified_handle text, requested_at timestamp with time zone';
  sel_new constant text := '         a.instagram_verified_handle,
         a.instagram,
         a.instagram_badge_ok,
         req.requested_at,';
  sel_old constant text := '         a.instagram_verified_handle,
         req.requested_at,';
begin
  def := pg_get_functiondef('public.support_list_verification_requests(text, uuid)'::regprocedure);
  if position('instagram_badge_ok' in def) = 0 then
    raise notice 'support_list_verification_requests ya está revertida: nada que hacer';
    return;
  end if;
  if position(ret_new in def) = 0 or position(sel_new in def) = 0 then
    raise exception 'support_list_verification_requests no tiene el texto esperado: revisar la definición viva antes de revertir';
  end if;
  drop function public.support_list_verification_requests(text, uuid);
  execute replace(replace(def, ret_new, ret_old), sel_new, sel_old);
end
$mig$;

revoke all on function public.support_list_verification_requests(text, uuid) from public, anon;
grant execute on function public.support_list_verification_requests(text, uuid) to authenticated, service_role;

create or replace function pg_temp.wo_patch_function(
  p_fn regprocedure, p_from text, p_to text, p_marker text, p_marker_when_done boolean
)
returns void
language plpgsql
as $patch$
declare
  def text;
  v_from text := replace(p_from, E'\r', '');
  v_to text := replace(p_to, E'\r', '');
begin
  def := pg_get_functiondef(p_fn);
  if (position(p_marker in def) > 0) = p_marker_when_done then
    raise notice '% ya está revertida: nada que hacer', p_fn;
    return;
  end if;
  if position(v_from in def) = 0 then
    raise exception '% no tiene el texto esperado: revisar la definición viva antes de revertir', p_fn;
  end if;
  execute replace(def, v_from, v_to);
  if (position(p_marker in pg_get_functiondef(p_fn)) > 0) <> p_marker_when_done then
    raise exception '% no quedó revertida', p_fn;
  end if;
end
$patch$;

select pg_temp.wo_patch_function(
  'public.get_artist_public_profile_preferences(uuid)'::regprocedure,
  $from$    'verified', (artist.verification_state = 'Yes' and coalesce(artist.instagram_badge_ok, false)),
    'badge_visible', (artist.verification_state = 'Yes' and coalesce(artist.instagram_badge_ok, false))
$from$,
  $to$    'verified', (
      artist.verification_state = 'Yes'
      or exists (
        select 1
          from public.artist_verification_documents doc
         where doc.artist_user_id = artist.user_id
           and doc.doc_type = 'identidad'
           and (lower(coalesce(doc.status, '')) like '%verific%'
                or lower(coalesce(doc.status, '')) like '%aprob%')
      )
    )
$to$,
  '''badge_visible''',
  false);

select pg_temp.wo_patch_function(
  'private.apply_studio_verification_decision(uuid, text, text, uuid)'::regprocedure,
  $from$
  if p_decision = 'approve' and not exists (select 1 from public.studios s
                                             where s.id = v_request.studio_id
                                               and s.instagram_badge_ok) then
    raise exception 'Antes de aprobar, valida el Instagram del estudio (código o confirmación de soporte).' using errcode = '22023';
  end if;
$from$,
  E'\n',
  'valida el Instagram del estudio',
  false);

select pg_temp.wo_patch_function(
  'public.support_set_artist_verification_state(uuid, text, text)'::regprocedure,
  $from$  if p_state = 'Yes' and not exists (select 1 from public.artists_db a
                                         where a.user_id = p_artist_user_id
                                           and a.instagram_badge_ok) then
    raise exception 'El Instagram del artista no está validado.' using errcode = '22023';
  end if;

  update public.artists_db
$from$,
  $to$  update public.artists_db
$to$,
  'El Instagram del artista no está validado.',
  false);

select pg_temp.wo_patch_function(
  'public.guard_artist_privileged_fields()'::regprocedure,
  $from$
    if coalesce(new.verification_state, 'No') = 'Requested'
       and not public.instagram_badge_ok_for(new.instagram, new.instagram_verified_at, new.instagram_verified_handle) then
      raise exception 'Antes de solicitarla, valida tu Instagram con el código.' using errcode = '42501';
    end if;
$from$,
  E'\n',
  'public.instagram_badge_ok_for(new.instagram',
  false);

select pg_temp.wo_patch_function(
  'public.request_artist_verification(uuid)'::regprocedure,
  $from$

  if not exists (select 1 from public.artists_db a
                  where a.user_id = p_artist_user_id
                    and a.instagram_badge_ok) then
    raise exception 'Antes de solicitarla, valida tu Instagram con el código.' using errcode = '22023';
  end if;
$from$,
  E'\n',
  'valida tu Instagram con el código',
  false);

drop function if exists pg_temp.wo_patch_function(regprocedure, text, text, text, boolean);

-- revoke select (columna) falla con 42703 si la columna ya no existe: solo se
-- revoca mientras la columna siga en la tabla (segunda corrida = nada que hacer).
do $revoke$
begin
  if exists (select 1 from pg_catalog.pg_attribute
              where attrelid = pg_catalog.to_regclass('public.artists_db')
                and attname = 'instagram_badge_ok'
                and not attisdropped) then
    revoke select (instagram_badge_ok) on public.artists_db from anon, authenticated;
  else
    raise notice 'public.artists_db.instagram_badge_ok ya no existe: nada que revocar';
  end if;
  if exists (select 1 from pg_catalog.pg_attribute
              where attrelid = pg_catalog.to_regclass('public.studios')
                and attname = 'instagram_badge_ok'
                and not attisdropped) then
    revoke select (instagram_badge_ok) on public.studios from anon, authenticated;
  else
    raise notice 'public.studios.instagram_badge_ok ya no existe: nada que revocar';
  end if;
end
$revoke$;

alter table public.artists_db drop column if exists instagram_badge_ok;
alter table public.studios drop column if exists instagram_badge_ok;

drop function if exists public.instagram_badge_ok_for(text, timestamptz, text);

notify pgrst, 'reload schema';

commit;
