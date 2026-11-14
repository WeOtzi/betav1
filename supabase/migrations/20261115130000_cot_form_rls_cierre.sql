-- ============================================================================
-- Cotizador web (frente cot-form) · cierre de la RLS abierta del intake
-- Hallazgos CC-04 / COT-A-06 (políticas anónimas) y CC-16 (bucket sin límites).
--
-- Contexto: el wizard /quotation ya no escribe la base desde el navegador.
-- Autosave y envío pasan por POST /api/quotations/intake (service role, llave
-- de borrador = submission_key); las referencias las registra el servidor
-- (quotations_attachments + reference_images) y el Job Board lo crea el
-- servidor. Por eso se pueden cerrar las políticas legacy que dejaban a
-- cualquier anónimo leer y modificar cotizaciones 'in_progress' (PII, salud y
-- trabajos en curso) e insertar cotizaciones, adjuntos e historial.
--
-- ORDEN DE DESPLIEGUE: aplicar DESPUÉS de desplegar el código del frente
-- cot-form (script.js ya no inserta adjuntos ni lee borradores ajenos).
--
-- Idempotente. Rollback: supabase/rollbacks/20261115130000_cot_form_rls_cierre.down.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. quotations_db: sin lectura/escritura anónima ni insert libre
-- ---------------------------------------------------------------------------
-- create_manual_quotation es SECURITY DEFINER, el intake y el Job Board usan
-- service role: ningún flujo legítimo necesita el insert abierto.
drop policy if exists "Allow anon select in_progress" on public.quotations_db;
drop policy if exists "Allow anon update in_progress quotations" on public.quotations_db;
drop policy if exists "Allow all insert quotations" on public.quotations_db;

-- TRUNCATE no pasa por RLS: ningún rol de la API debe tenerlo.
revoke truncate, references, trigger on public.quotations_db from anon, authenticated;

-- El cliente (por clients_update_own_quotations) solo puede vincular la
-- cotización a su cuenta o esconderla. Todo lo demás (estado, montos,
-- artista, datos de la propuesta) lo cambian el artista dueño, soporte o el
-- servidor (service role / funciones security definer, donde current_user
-- no es anon ni authenticated).
create or replace function public.fn_quotations_client_column_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_changed text[];
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if v_uid is not null and old.artist_id is not null and old.artist_id = v_uid then
    return new;
  end if;
  if public.is_support_user() then
    return new;
  end if;

  select array_agg(n.key order by n.key)
    into v_changed
    from jsonb_each(to_jsonb(new)) as n
   where n.value is distinct from (to_jsonb(old) -> n.key)
     and n.key not in ('client_user_id', 'client_deleted_at', 'updated_at');

  if v_changed is not null then
    raise exception 'No podés modificar estos datos de la cotización: %', array_to_string(v_changed, ', ')
      using errcode = '42501';
  end if;

  if new.client_user_id is distinct from old.client_user_id
     and not (old.client_user_id is null and v_uid is not null and new.client_user_id = v_uid) then
    raise exception 'Solo podés vincular la cotización a tu propia cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- "trg_a_" corre después de quotations_updated (updated_at) y antes de los
-- triggers de estado/precios (orden alfabético de los BEFORE UPDATE).
drop trigger if exists trg_a_quotations_client_column_guard on public.quotations_db;
create trigger trg_a_quotations_client_column_guard
  before update on public.quotations_db
  for each row execute function public.fn_quotations_client_column_guard();

-- ---------------------------------------------------------------------------
-- 2. quotation_status_history: lo escribe el trigger fn_quotation_status_change
--    con el rol del que actualiza. Un anónimo ya no actualiza cotizaciones.
-- ---------------------------------------------------------------------------
drop policy if exists "Allow anon insert on status history" on public.quotation_status_history;

-- El insert de authenticated era libre (with check true): cualquier cuenta
-- podía escribir historial falso de cotizaciones ajenas. El trigger (no es
-- security definer) inserta con el rol del que cambia el estado: el artista
-- dueño o soporte. Se acota a soporte o a las partes de la cotización.
drop policy if exists "Allow authenticated insert on status history" on public.quotation_status_history;
create policy "Allow authenticated insert on status history" on public.quotation_status_history
  for insert to authenticated
  with check (
    public.is_support_user()
    or exists (
      select 1 from public.quotations_db q
       where q.quote_id::text = quotation_status_history.quote_id::text
         and (q.artist_id = (select auth.uid()) or q.client_user_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- 3. quotation_intake_extras: solo las partes o soporte (el intake usa service role)
-- ---------------------------------------------------------------------------
drop policy if exists qie_insert_open on public.quotation_intake_extras;
drop policy if exists qie_select_parties on public.quotation_intake_extras;
drop policy if exists qie_update_draft_or_parties on public.quotation_intake_extras;

create policy qie_select_parties on public.quotation_intake_extras
  for select to authenticated
  using (
    public.is_support_user()
    or exists (
      select 1 from public.quotations_db q
       where q.quote_id::text = quotation_intake_extras.quote_id
         and (q.artist_id = (select auth.uid()) or q.client_user_id = (select auth.uid()))
    )
  );

create policy qie_update_draft_or_parties on public.quotation_intake_extras
  for update to authenticated
  using (
    public.is_support_user()
    or exists (
      select 1 from public.quotations_db q
       where q.quote_id::text = quotation_intake_extras.quote_id
         and (q.artist_id = (select auth.uid()) or q.client_user_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- 4. quotations_attachments: insert y lectura solo de las partes o soporte.
--    Las referencias del cliente anónimo las inserta el servidor.
-- ---------------------------------------------------------------------------
drop policy if exists attachments_public_insert on public.quotations_attachments;
drop policy if exists attachments_parties_insert on public.quotations_attachments;
create policy attachments_parties_insert on public.quotations_attachments
  for insert to authenticated
  with check (
    public.is_support_user()
    or exists (
      select 1 from public.quotations_db q
       where q.quote_id::text = quotations_attachments.quotation_id
         and (q.artist_id = (select auth.uid()) or q.client_user_id = (select auth.uid()))
    )
  );

drop policy if exists attachments_select_visible on public.quotations_attachments;
create policy attachments_select_visible on public.quotations_attachments
  for select to authenticated
  using (
    public.is_support_user()
    or exists (
      select 1 from public.quotations_db q
       where q.quote_id::text = quotations_attachments.quotation_id
         and (q.client_user_id = (select auth.uid()) or q.artist_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Bucket quotation-references: tamaño, tipos y destino de las subidas
-- ---------------------------------------------------------------------------
-- El wizard comprime a JPEG (~1 MB); 10 MB y los videos cubren la media de
-- body-parts/expanded que sube el backoffice. La cotización manual del
-- artista (/my-quotations/new) acepta imágenes y PDF. Sin SVG: el bucket es
-- público y un SVG puede llevar scripts.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif',
         'application/pdf',
         'video/mp4', 'video/webm', 'video/quicktime'
       ]
 where id = 'quotation-references';

-- ¿El folder corresponde a un borrador web abierto? (security definer: el
-- anónimo ya no puede leer quotations_db).
create or replace function private.is_open_web_quote_draft(p_quote_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_quote_id ~ '^QN[0-9a-f]{32}$'
     and exists (
       select 1 from public.quotations_db q
        where q.quote_id = p_quote_id
          and q.quote_status = 'in_progress'
          and q.artist_responded_at is null
     );
$$;

revoke all on function private.is_open_web_quote_draft(text) from public;
grant execute on function private.is_open_web_quote_draft(text) to anon, authenticated, service_role;

-- ¿El folder es una cotización del artista que sube (o la sube soporte)?
-- Lo usa la cotización manual (quotation-new.js sube a <quote_id>/<archivo>).
create or replace function private.is_own_quote_folder(p_quote_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_quote_id, '') <> ''
     and (
       public.is_support_user()
       or exists (
         select 1 from public.quotations_db q
          where q.quote_id = p_quote_id
            and q.artist_id = (select auth.uid())
       )
     );
$$;

revoke all on function private.is_own_quote_folder(text) from public;
-- anon también: la política es una sola para anon y authenticated (para un
-- anónimo devuelve false; auth.uid() es null).
grant execute on function private.is_own_quote_folder(text) to anon, authenticated, service_role;

drop policy if exists "Public Insert for quotation-references" on storage.objects;
create policy "Public Insert for quotation-references" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'quotation-references'
    and (
      (
        name ~ '^QN[0-9a-f]{32}/ref_[0-9]{1,2}_[0-9]{10,14}\.(jpe?g|png|webp|gif|heic|heif)$'
        and private.is_open_web_quote_draft(split_part(name, '/', 1))
      )
      -- Imágenes y media de zonas del cuerpo (backoffice, con sesión).
      or (name like 'body-parts/%' and (select auth.role()) = 'authenticated')
      -- Referencias de la cotización manual: el artista dueño o soporte.
      or (
        (select auth.role()) = 'authenticated'
        and private.is_own_quote_folder(split_part(name, '/', 1))
      )
    )
  );

commit;
