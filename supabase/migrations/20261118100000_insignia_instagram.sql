-- ============================================================================
-- La insignia de verificado exige controlar el Instagram (plan KYC 1.5)
-- ============================================================================
-- Hasta ahora la insignia de artista salía solo de verification_state = 'Yes'
-- y la de estudio de is_verified. El código de Instagram existía pero no
-- contaba. Desde esta migración:
--
--   1. Columna generada instagram_badge_ok (artists_db y studios): true cuando
--      el Instagram del perfil, normalizado como normalizeHandle
--      (services/instagram-verification.js), es el mismo que se validó
--      (instagram_verified_handle) y hay instagram_verified_at. Exige un
--      Instagram cargado en el perfil (más estricto que buildInstagramState).
--      Si el artista o el estudio cambia su Instagram, la columna pasa a false
--      sola y la insignia se oculta hasta validar el nuevo. NO se agrega un
--      trigger que borre instagram_verified_at: ocultaría también las fotos
--      importadas de Instagram (sync_artist_gallery_feed_items).
--      La regla vive en public.instagram_badge_ok_for(...) y la usa también el
--      trigger guardián (en un BEFORE trigger la columna generada todavía no
--      está calculada). Espejo en el navegador: public/shared/js/verified-badge.js.
--   2. request_artist_verification: después de los documentos, exige el
--      Instagram validado («Antes de solicitarla, valida tu Instagram con el
--      código.», 22023).
--   3. guard_artist_privileged_fields: el mismo requisito en las ramas INSERT
--      y UPDATE que pasan a 'Requested' (el cliente puede escribir el estado
--      directo, sin pasar por la RPC).
--   4. support_set_artist_verification_state (3 argumentos): soporte no puede
--      aprobar ('Yes') sin el Instagram validado.
--   5. private.apply_studio_verification_decision: aprobar exige el Instagram
--      del estudio validado (por código o confirmado por soporte). Los dos
--      envoltorios (decide_studio_verification y _as) lo heredan.
--   6. get_artist_public_profile_preferences: 'verified' = estado 'Yes' y
--      Instagram validado (se quita la rama del documento de identidad
--      aprobado) y se agrega 'badge_visible' con el mismo valor.
--   7. support_list_verification_requests (cola de soporte): suma instagram e
--      instagram_badge_ok para mostrar «Instagram validado» o que no coincide.
--      Cambia el tipo de retorno: se borra y se vuelve a crear con los mismos
--      permisos (authenticated y service_role; sin anon).
--
-- Las funciones se cambian sobre la definición VIVA (pg_get_functiondef) con
-- replace() de un texto ancla: si el ancla no está, la migración falla sin
-- tocar nada. Se puede volver a correr: lo ya aplicado se saltea.
--
-- Sin abuelos: el único estudio verificado hoy no tiene Instagram validado y
-- pierde la insignia hasta que soporte confirme su Instagram.
-- Reversa: supabase/rollbacks/20261118100000_insignia_instagram.down.sql
-- ============================================================================

begin;

-- 1 · Regla de la insignia ----------------------------------------------------

create or replace function public.instagram_badge_ok_for(
  p_instagram text,
  p_verified_at timestamptz,
  p_verified_handle text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select p_verified_at is not null
     and h.handle ~ '^[a-z0-9._]{1,30}$'
     and h.handle = pg_catalog.lower(pg_catalog.btrim(coalesce(p_verified_handle, '')))
    from (
      select pg_catalog.lower(
               pg_catalog.regexp_replace(
                 pg_catalog.regexp_replace(
                   pg_catalog.btrim(coalesce(p_instagram, '')),
                   '^(https?://)?(www\.|m\.)?instagram\.com/([^/?#[:space:]]+).*$', '\3', 'i'),
                 '^@+', '')) as handle
    ) h
$fn$;

comment on function public.instagram_badge_ok_for(text, timestamptz, text) is
  'Instagram del perfil (normalizado como normalizeHandle) = Instagram validado con código o por soporte. Base de la insignia de verificado.';

revoke all on function public.instagram_badge_ok_for(text, timestamptz, text) from public;
grant execute on function public.instagram_badge_ok_for(text, timestamptz, text) to anon, authenticated, service_role;

alter table public.artists_db
  add column if not exists instagram_badge_ok boolean
  generated always as (public.instagram_badge_ok_for(instagram, instagram_verified_at, instagram_verified_handle)) stored;

alter table public.studios
  add column if not exists instagram_badge_ok boolean
  generated always as (public.instagram_badge_ok_for(instagram, instagram_verified_at, instagram_verified_handle)) stored;

comment on column public.artists_db.instagram_badge_ok is
  'Generada: el Instagram del perfil es el validado. La insignia exige verification_state = ''Yes'' y esta columna.';
comment on column public.studios.instagram_badge_ok is
  'Generada: el Instagram del estudio es el validado. La insignia exige is_verified y esta columna.';

grant select (instagram_badge_ok) on public.artists_db to anon, authenticated;
grant select (instagram_badge_ok) on public.studios to anon, authenticated;

-- Parche de funciones sobre la definición viva (solo dura esta sesión) -------
-- p_marker_when_done: true si el marcador debe estar después del cambio.

create function pg_temp.wo_patch_function(
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
    raise notice '% ya tiene el cambio: nada que hacer', p_fn;
    return;
  end if;
  if position(v_from in def) = 0 then
    raise exception '% no tiene el texto ancla esperado: revisar la definición viva antes de aplicar', p_fn;
  end if;
  execute replace(def, v_from, v_to);
  if (position(p_marker in pg_get_functiondef(p_fn)) > 0) <> p_marker_when_done then
    raise exception '% no quedó con el cambio esperado', p_fn;
  end if;
end
$patch$;

-- 2 · request_artist_verification ---------------------------------------------

select pg_temp.wo_patch_function(
  'public.request_artist_verification(uuid)'::regprocedure,
  $from$    raise exception 'Antes de solicitarla, subí %.', array_to_string(v_missing, ' y ') using errcode = '22023';
  end if;
$from$,
  $to$    raise exception 'Antes de solicitarla, subí %.', array_to_string(v_missing, ' y ') using errcode = '22023';
  end if;

  if not exists (select 1 from public.artists_db a
                  where a.user_id = p_artist_user_id
                    and a.instagram_badge_ok) then
    raise exception 'Antes de solicitarla, valida tu Instagram con el código.' using errcode = '22023';
  end if;
$to$,
  'valida tu Instagram con el código',
  true);

-- 3 · guard_artist_privileged_fields (ramas INSERT y UPDATE) -----------------
-- El ancla aparece dos veces (una por rama) y replace() cambia las dos.

select pg_temp.wo_patch_function(
  'public.guard_artist_privileged_fields()'::regprocedure,
  $from$      raise exception 'Para solicitar la verificación subí tu documento de identidad y tu comprobante de domicilio.' using errcode = '42501';
    end if;
$from$,
  $to$      raise exception 'Para solicitar la verificación subí tu documento de identidad y tu comprobante de domicilio.' using errcode = '42501';
    end if;
    if coalesce(new.verification_state, 'No') = 'Requested'
       and not public.instagram_badge_ok_for(new.instagram, new.instagram_verified_at, new.instagram_verified_handle) then
      raise exception 'Antes de solicitarla, valida tu Instagram con el código.' using errcode = '42501';
    end if;
$to$,
  'public.instagram_badge_ok_for(new.instagram',
  true);

-- 4 · support_set_artist_verification_state (3 argumentos) -------------------

select pg_temp.wo_patch_function(
  'public.support_set_artist_verification_state(uuid, text, text)'::regprocedure,
  $from$  update public.artists_db
     set verification_state = p_state
$from$,
  $to$  if p_state = 'Yes' and not exists (select 1 from public.artists_db a
                                         where a.user_id = p_artist_user_id
                                           and a.instagram_badge_ok) then
    raise exception 'El Instagram del artista no está validado.' using errcode = '22023';
  end if;

  update public.artists_db
     set verification_state = p_state
$to$,
  'El Instagram del artista no está validado.',
  true);

-- 5 · private.apply_studio_verification_decision -----------------------------

select pg_temp.wo_patch_function(
  'private.apply_studio_verification_decision(uuid, text, text, uuid)'::regprocedure,
  $from$  if v_request.status <> 'pending' then raise exception 'La solicitud ya fue resuelta.' using errcode = '23514'; end if;
$from$,
  $to$  if v_request.status <> 'pending' then raise exception 'La solicitud ya fue resuelta.' using errcode = '23514'; end if;
  if p_decision = 'approve' and not exists (select 1 from public.studios s
                                             where s.id = v_request.studio_id
                                               and s.instagram_badge_ok) then
    raise exception 'Antes de aprobar, valida el Instagram del estudio (código o confirmación de soporte).' using errcode = '22023';
  end if;
$to$,
  'valida el Instagram del estudio',
  true);

-- 6 · get_artist_public_profile_preferences ----------------------------------

select pg_temp.wo_patch_function(
  'public.get_artist_public_profile_preferences(uuid)'::regprocedure,
  $from$    'verified', (
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
$from$,
  $to$    'verified', (artist.verification_state = 'Yes' and coalesce(artist.instagram_badge_ok, false)),
    'badge_visible', (artist.verification_state = 'Yes' and coalesce(artist.instagram_badge_ok, false))
$to$,
  '''badge_visible''',
  true);

drop function pg_temp.wo_patch_function(regprocedure, text, text, text, boolean);

-- 7 · support_list_verification_requests ------------------------------------

do $mig$
declare
  def text;
  ret_old constant text := 'instagram_verified_handle text, requested_at timestamp with time zone';
  ret_new constant text := 'instagram_verified_handle text, instagram text, instagram_badge_ok boolean, requested_at timestamp with time zone';
  sel_old constant text := '         a.instagram_verified_handle,
         req.requested_at,';
  sel_new constant text := '         a.instagram_verified_handle,
         a.instagram,
         a.instagram_badge_ok,
         req.requested_at,';
begin
  def := pg_get_functiondef('public.support_list_verification_requests(text, uuid)'::regprocedure);
  if position('instagram_badge_ok' in def) > 0 then
    raise notice 'support_list_verification_requests ya devuelve instagram_badge_ok: nada que hacer';
    return;
  end if;
  if position(ret_old in def) = 0 or position(sel_old in def) = 0 then
    raise exception 'support_list_verification_requests no tiene el texto ancla esperado: revisar la definición viva antes de aplicar';
  end if;
  drop function public.support_list_verification_requests(text, uuid);
  execute replace(replace(def, ret_old, ret_new), sel_old, sel_new);
end
$mig$;

revoke all on function public.support_list_verification_requests(text, uuid) from public, anon;
grant execute on function public.support_list_verification_requests(text, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
