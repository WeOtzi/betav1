-- 1) Elimina el espejo de contrasenas en texto plano.
--    artists_db.password era legible con la anon key (verificado contra la API
--    REST: 3 cuentas expuestas). Los valores ya se anularon en caliente; esta
--    migracion elimina la columna. auth.users es la unica fuente de verdad y
--    todo el codigo que escribia/leia el espejo fue eliminado en este commit.
ALTER TABLE public.artists_db DROP COLUMN IF EXISTS password;

-- 2) handle_new_user: los signups de clientes y estudios ya no crean una fila
--    en artists_db. Antes TODO usuario nuevo recibia una (deuda detectada en la
--    revision del 2026-06-10; a la fecha no habia filas contaminadas porque
--    ningun cliente/estudio se registro desde que el trigger existe).
--    user_type viene en los metadatos del signUp:
--      'client' (client-auth.js, job-board-request.js), 'studio'
--      (studio-auth.js), 'artist' (artist-login.js, main.js). Si falta
--      (flujos legacy/OAuth), se conserva el comportamiento de crear artista.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF signup_type NOT IN ('client', 'studio') THEN
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
    -- Nunca bloquear el signup por un problema del perfil
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
      WHERE client_user_id IS NULL
        AND lower((client_email)::text) = lower(coalesce(new.email, ''));
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  RETURN new;
END;
$$;
