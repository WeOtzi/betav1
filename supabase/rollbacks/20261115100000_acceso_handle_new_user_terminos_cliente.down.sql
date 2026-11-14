-- Reversa de 20261115100000_acceso_handle_new_user_terminos_cliente.sql
-- Restaura handle_new_user tal como estaba en vivo el 14 nov 2026
-- (pg_get_functiondef) y quita las columnas de Términos de clients_db.
-- Las aceptaciones guardadas en clients_db se pierden con las columnas.

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
BEGIN
  IF lower(coalesce(new.email, '')) = 'isai@weotzi.com'
     OR lower(coalesce(new.raw_user_meta_data->>'role', '')) = 'superadmin'
     OR lower(coalesce(new.raw_app_meta_data->>'role', '')) = 'superadmin' THEN
    RETURN new;
  END IF;

  signup_type := lower(coalesce(new.raw_user_meta_data->>'user_type', ''));

  extracted_name := COALESCE(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );

  IF signup_type NOT IN ('client', 'studio', 'supplies') AND nullif(new.raw_user_meta_data->>'registration_draft_id', '') IS NULL THEN
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
        city_residence, health_conditions, allergies, email_verified
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
        false
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

drop trigger if exists trg_guard_client_terms_acceptance on public.clients_db;
drop function if exists public.guard_client_terms_acceptance();
alter table public.clients_db
  drop column if exists terms_version,
  drop column if exists terms_accepted_at;
