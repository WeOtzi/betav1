-- ============================================================================
-- Perfil público: integridad del username y sello "Verificado" consistente
-- (auditoría perfil-publico PP-13 y PP-11, beta cerrada nov 2026).
--
-- 1) Formato. artists_db.username es el handle público del artista y arma su
--    URL corta (beta.weotzi.com/<handle>). Desde ahora, cada alta o cambio de
--    username tiene que cumplir ^[a-z0-9]{1,30}\.wo$ (lo mismo que generan el
--    registro y lib/artist-registration.js). El trigger lo pasa a minúsculas y
--    le quita espacios antes de validar. Las filas viejas que no cumplen
--    (filas de QA) no se tocan: el control corre solo cuando el username
--    cambia, así que se pueden seguir editando sus otras columnas.
--
-- 2) Unicidad. Índice único sobre lower(username) para las filas finalizadas
--    (registration_status distinto de 'incompleto'). Es la misma regla que ya
--    aplica el registro (getRegistrationConflicts): un borrador incompleto no
--    reserva el usuario, pero no puede finalizar con un usuario que ya tiene
--    otro artista. El índice es parcial, así que convive con el duplicado vivo
--    'profeclaudiaa.wo' (una fila 'incompleto' y otra finalizada). El trigger
--    da un mensaje en español antes de que salte el índice.
--
--    Sin esto, un artista podía poner por API el username de otro (tiene
--    UPDATE sobre la columna) y romper o secuestrar su perfil público.
--
-- 3) Sello "Verificado". get_artist_public_profile_preferences agrega la
--    clave `verified`: verification_state = 'Yes' o un documento de identidad
--    aprobado por soporte. Es la misma regla que usa el centro de la cuenta
--    (artist-account.js isVerified), así el perfil público y la cuenta nunca
--    se contradicen.
--
-- Idempotente. Reversa: supabase/rollbacks/20261115110000_perfil_username_integridad.down.sql
-- ============================================================================

-- 1) Formato + mensaje de unicidad ------------------------------------------

create or replace function public.wo_artist_username_is_valid(p_username text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_username is not null and p_username ~ '^[a-z0-9]{1,30}\.wo$';
$$;

comment on function public.wo_artist_username_is_valid(text) is
  'Formato del username público del artista: 1 a 30 letras minúsculas o números seguidos de .wo.';

create or replace function public.guard_artist_username()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
declare
  v_changed boolean;
begin
  if new.username is not null then
    new.username := lower(btrim(new.username));
    if new.username = '' then
      new.username := null;
    end if;
  end if;

  v_changed := tg_op = 'INSERT' or new.username is distinct from old.username;

  if v_changed then
    -- Un perfil publicado no se puede quedar sin usuario: su URL dejaría de existir.
    if new.username is null then
      if tg_op = 'UPDATE' and old.username is not null
         and new.registration_status is distinct from 'incompleto' then
        raise exception 'El nombre de usuario es obligatorio.' using errcode = '23502';
      end if;
    elsif not public.wo_artist_username_is_valid(new.username) then
      raise exception 'El nombre de usuario lleva solo letras minúsculas y números (hasta 30) y termina en .wo.'
        using errcode = '23514';
    end if;
  end if;

  -- Mensaje claro antes del índice único (que sigue siendo la garantía real).
  if new.username is not null
     and new.registration_status is distinct from 'incompleto'
     and (v_changed or new.registration_status is distinct from old.registration_status)
     and exists (
       select 1
         from public.artists_db other
        where lower(other.username) = new.username
          and other.registration_status is distinct from 'incompleto'
          and other.id is distinct from new.id
     ) then
    raise exception 'Ese nombre de usuario ya está en uso.' using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.guard_artist_username() is
  'Normaliza y valida artists_db.username (formato y unicidad entre perfiles finalizados).';

drop trigger if exists trg_guard_artist_username on public.artists_db;
create trigger trg_guard_artist_username
  before insert or update of username, registration_status on public.artists_db
  for each row execute function public.guard_artist_username();

-- 2) Unicidad --------------------------------------------------------------

create unique index if not exists artists_db_username_lower_finalized_uniq
  on public.artists_db (lower(username))
  where username is not null and registration_status is distinct from 'incompleto';

-- 3) Sello "Verificado" en las preferencias públicas -------------------------

create or replace function public.get_artist_public_profile_preferences(p_artist_user_id uuid)
returns jsonb
language sql
stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'privacy', jsonb_build_object(
      'show_city', coalesce((prefs.privacy ->> 'show_city')::boolean, true),
      'show_rating', coalesce((prefs.privacy ->> 'show_rating')::boolean, true),
      'show_socials', coalesce((prefs.privacy ->> 'show_socials')::boolean, true),
      'allow_search_indexing', coalesce((prefs.privacy ->> 'allow_search_indexing')::boolean, false)
    ),
    'profile', jsonb_build_object(
      'full_name', nullif(btrim(prefs.app_settings #>> '{profile,full_name}'), ''),
      'tiktok', nullif(btrim(prefs.app_settings #>> '{profile,tiktok}'), ''),
      'banner_url', nullif(btrim(prefs.app_settings #>> '{profile,banner_url}'), '')
    ),
    'availability', coalesce(prefs.app_settings -> 'availability', '{}'::jsonb),
    'instagram_validation', jsonb_build_object(
      'enforced', true,
      'verified', artist.instagram_verified_at is not null,
      'handle', nullif(btrim(artist.instagram_verified_handle), '')
    ),
    -- Misma regla que el centro de la cuenta (artist-account.js isVerified).
    'verified', (
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
  )
  from public.artists_db artist
  left join public.user_preferences prefs on prefs.user_id = artist.user_id
  where artist.user_id = p_artist_user_id
  limit 1;
$$;

revoke all on function public.get_artist_public_profile_preferences(uuid) from public;
grant execute on function public.get_artist_public_profile_preferences(uuid) to anon, authenticated, service_role;
