-- Acceso · beta cerrada (15 nov 2026). Frente "acceso".
--
-- ACC-03 · Un cliente que entraba con Google quedaba con una fila PÚBLICA y
--   vacía en artists_db: handle_new_user creaba el artista para todo usuario sin
--   user_type (y con OAuth nunca hay metadatos de rol). La RLS pública muestra
--   todo lo que no sea 'incompleto', así que aparecía como artista vacío en el
--   marketplace, y artist-login / client-auth lo mandaban al panel de artista.
--   Ahora el INSERT en artists_db solo corre para altas por email (provider
--   'email') o con rol de artista explícito. Con Google/Facebook la fila la crea
--   el wizard de /register-artist al terminar (upsert_my_artist_profile) y el
--   perfil de cliente lo crea client-auth.js al volver del proveedor.
--   NO se borran filas existentes: trigger_delete_auth_on_artist_delete borra
--   el usuario de Auth al borrar la fila de artista. La limpieza de las filas
--   fantasma (pasarlas a 'incompleto') queda como acción aparte con OK del
--   dueño: scripts/ops/acceso-ocultar-artistas-oauth.sql.
--
-- ACC-08 · Aceptación de Términos y Privacidad del cliente.
--   - clients_db.terms_accepted_at / terms_version (como artists_db).
--   - guard_client_terms_acceptance: el navegador no puede escribirlas (igual
--     que guard_artist_terms_acceptance); solo service-role, soporte o el
--     propio handle_new_user (security definer, corre como postgres).
--   - handle_new_user sella now() y la versión vigente cuando el alta trae
--     raw_user_meta_data.terms_accepted = true. Nunca copia una fecha del
--     metadata (lo controla el usuario). Versión = lib/terms-acceptance.js
--     TERMS_VERSION ('2026-11-13'); subirla en los dos lados a la vez.
--   - Google/Facebook: lo sella el servidor (POST /api/account/terms).
--
-- Basado en la definición VIVA de handle_new_user (pg_get_functiondef,
-- 14 nov 2026), que difiere del repo. Se conserva todo lo demás tal cual:
-- superadmin, rama client (incluido el enlace de cotizaciones por email con
-- qa_unverified_email), studio y supplies.
--
-- Idempotente. Reversa: supabase/rollbacks/20261115100000_acceso_handle_new_user_terminos_cliente.down.sql

-- ACC-08 · columnas ---------------------------------------------------------
alter table public.clients_db
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

comment on column public.clients_db.terms_accepted_at is
  'Fecha en que el cliente aceptó los Términos y la Política de Privacidad (la escribe la base o el servidor, nunca el navegador).';
comment on column public.clients_db.terms_version is
  'Versión de los términos aceptados (lib/terms-acceptance.js TERMS_VERSION).';

-- ACC-08 · guard -------------------------------------------------------------
create or replace function public.guard_client_terms_acceptance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or coalesce(public.is_support_user(), false) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.terms_accepted_at := null;
    new.terms_version := null;
    return new;
  end if;
  new.terms_accepted_at := old.terms_accepted_at;
  new.terms_version := old.terms_version;
  return new;
end;
$$;

drop trigger if exists trg_guard_client_terms_acceptance on public.clients_db;
create trigger trg_guard_client_terms_acceptance
  before insert or update on public.clients_db
  for each row execute function public.guard_client_terms_acceptance();

-- ACC-03 + ACC-08 · handle_new_user -----------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  extracted_name text;
  extracted_username text;
  signup_type text;
  signup_role text;
  signup_provider text;
  terms_ok boolean;
  -- Igual a lib/terms-acceptance.js TERMS_VERSION.
  current_terms_version constant text := '2026-11-13';
BEGIN
  IF lower(coalesce(new.email, '')) = 'isai@weotzi.com'
     OR lower(coalesce(new.raw_user_meta_data->>'role', '')) = 'superadmin'
     OR lower(coalesce(new.raw_app_meta_data->>'role', '')) = 'superadmin' THEN
    RETURN new;
  END IF;

  signup_type := lower(coalesce(new.raw_user_meta_data->>'user_type', ''));
  signup_role := lower(coalesce(new.raw_user_meta_data->>'role', ''));
  -- GoTrue completa app_metadata.provider al crear el usuario ('email',
  -- 'google', 'facebook'…). Sin dato se trata como alta por email (comportamiento anterior).
  signup_provider := lower(coalesce(nullif(new.raw_app_meta_data->>'provider', ''), 'email'));
  terms_ok := lower(coalesce(new.raw_user_meta_data->>'terms_accepted', '')) = 'true';

  extracted_name := COALESCE(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );

  IF signup_type NOT IN ('client', 'studio', 'supplies')
     AND nullif(new.raw_user_meta_data->>'registration_draft_id', '') IS NULL
     -- ACC-03: con OAuth no se sabe el rol; no se inventa un artista público.
     AND (signup_provider = 'email' OR signup_type = 'artist' OR signup_role = 'artist') THEN
    extracted_username := COALESCE(
      new.raw_user_meta_data->>'username',
      new.raw_user_meta_data->>'user_name',
      new.raw_user_meta_data->>'preferred_username',
      split_part(new.email, '@', 1)
    );

    INSERT INTO public.artists_db (user_id, email, name, username)
    VALUES (
      new.id,
      new.email,
      extracted_name,
      extracted_username
    )
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      name = COALESCE(artists_db.name, EXCLUDED.name),
      username = COALESCE(artists_db.username, EXCLUDED.username);
  END IF;

  IF signup_type = 'client' THEN
    BEGIN
      INSERT INTO public.clients_db (
        user_id, email, full_name, whatsapp, birth_date, age, instagram,
        city_residence, health_conditions, allergies, email_verified,
        terms_accepted_at, terms_version
      )
      VALUES (
        new.id,
        new.email,
        extracted_name,
        nullif(new.raw_user_meta_data->>'whatsapp', ''),
        nullif(new.raw_user_meta_data->>'birth_date', '')::date,
        COALESCE(
          nullif(new.raw_user_meta_data->>'age', '')::int,
          CASE WHEN nullif(new.raw_user_meta_data->>'birth_date', '') IS NOT NULL
            THEN date_part('year', age((new.raw_user_meta_data->>'birth_date')::date))::int
          END
        ),
        nullif(new.raw_user_meta_data->>'instagram', ''),
        nullif(new.raw_user_meta_data->>'city_residence', ''),
        nullif(new.raw_user_meta_data->>'health_conditions', ''),
        nullif(new.raw_user_meta_data->>'allergies', ''),
        false,
        -- ACC-08: hora de la base, nunca una fecha del metadata.
        CASE WHEN terms_ok THEN now() END,
        CASE WHEN terms_ok THEN current_terms_version END
      )
      ON CONFLICT (user_id) DO NOTHING;
    EXCEPTION WHEN others THEN
      NULL;
    END;

    BEGIN
      UPDATE public.quotations_db
      SET client_user_id = new.id
      WHERE client_user_id IS NULL AND new.email_confirmed_at IS NOT NULL AND coalesce(new.raw_user_meta_data->>'qa_unverified_email', 'false') <> 'true' AND coalesce(new.raw_app_meta_data->>'qa_unverified_email', 'false') <> 'true'
        AND lower((client_email)::text) = lower(coalesce(new.email, ''));
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  RETURN new;
END;
$function$;
