-- Ronda 3c · grupo "cifrado": LIMPIEZA de los datos en claro.
--
-- ⚠ NO APLICAR hasta que el dueño confirme. Vive en supabase/pending/ (no en
--   migrations/) para que ningún `db push` la aplique por accidente. Para
--   aplicarla: moverla a supabase/migrations/ con el mismo nombre.
--
-- Requisitos (en este orden):
--   1. 20261113104000_field_encryption.sql aplicada.
--   2. node scripts/encrypt-existing-data.cjs --apply   (cifra todo)
--   3. node scripts/encrypt-existing-data.cjs --verify  → "0 discrepancias"
--      (descifra cada sobre y lo compara con la columna en claro).
--   4. Backup lógico de la tabla (Supabase → Database → Backups o pg_dump -t).
--
-- Qué hace:
--   - Aborta si queda algún destino con dato en claro y SIN sobre cifrado.
--   - Pone account_identifier = null en las filas cifradas (sin tocar el
--     estado de verificación: el guard se desactiva solo durante el update).
--   - Agrega un check para que nunca vuelva a guardarse en claro.
--   - Aborta si apify_token sigue en claro en app_settings.
--
-- Reversa: no recupera el dato desde SQL (la clave vive solo en el servidor):
--   node scripts/encrypt-existing-data.cjs --restore-plaintext --apply
--   y luego: alter table public.artist_payout_destinations
--              drop constraint if exists artist_payout_destinations_no_plaintext;

begin;

do $$
declare
  v_pending int;
  v_apify text;
begin
  select count(*) into v_pending
    from public.artist_payout_destinations
   where account_identifier is not null
     and (account_identifier_enc is null or account_identifier_last4 is null);
  if v_pending > 0 then
    raise exception 'Hay % destino(s) con el número en claro sin cifrar: corré scripts/encrypt-existing-data.cjs --apply y --verify.', v_pending;
  end if;

  select setting_value into v_apify from public.app_settings where setting_key = 'apify_token';
  if v_apify is not null and v_apify <> '' and v_apify not like 'wo1:%' then
    raise exception 'apify_token sigue en claro en app_settings: corré scripts/encrypt-existing-data.cjs --apply.';
  end if;
end;
$$;

-- Sin el guard: desde el SQL editor no hay JWT y el guard trataría el cambio
-- de account_identifier como una cuenta nueva (volvería todo a 'pending').
alter table public.artist_payout_destinations disable trigger trg_guard_artist_payout_destination;

update public.artist_payout_destinations
   set account_identifier = null
 where account_identifier is not null
   and account_identifier_enc is not null;

alter table public.artist_payout_destinations enable trigger trg_guard_artist_payout_destination;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'artist_payout_destinations_no_plaintext'
                 and conrelid = 'public.artist_payout_destinations'::regclass) then
    alter table public.artist_payout_destinations
      add constraint artist_payout_destinations_no_plaintext check (account_identifier is null);
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
