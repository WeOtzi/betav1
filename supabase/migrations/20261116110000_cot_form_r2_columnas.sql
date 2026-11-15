-- ============================================================================
-- Cotizador web · ronda 2 (frente cot-form) · columnas nuevas de la cotización
--
-- quotations_db
--   short_code                 text    Código corto visible (6 caracteres, sin
--                                      0/1/I/L/O). Único. Lo asigna el trigger en
--                                      cada alta (cualquier origen) y no cambia.
--                                      El quote_id interno NO cambia.
--   client_is_minor            boolean true si el cliente tiene menos de 18 años
--                                      según client_birth_date (lo deriva el
--                                      trigger al guardar la fecha; null = sin
--                                      fecha de nacimiento).
--   preferred_date_from/_to    date    Rango tentativo que eligió el cliente en
--                                      el calendario (P14). client_preferred_date
--                                      sigue guardando el texto visible.
--   preferred_location_*               Sede/ciudad que eligió el cliente (P27):
--     _type    'artist_base' | 'artist_location' | 'studio_location' | 'trip'
--     _ref     id de la fila de origen (artist_tattoo_locations.id,
--              studio_locations.id o artist_trips.id; null en artist_base)
--     _label   texto que vio el cliente ("CLAROSCURO · Sede principal · Buenos Aires")
--     _city / _country
--     _studio_id  estudio de la sede (si aplica)
--     _from / _to fechas de la estadía (guest spot o viaje), si aplica
--   reused_from_quote_id       text    Cotización de la que se clonó este
--                                      borrador ("Cotizar con otro artista", P32).
--
-- quotations_attachments
--   note          text     Comentario del cliente sobre ESA imagen (P13).
--   ai_generated  boolean  La referencia se generó con IA (P7): solo referencial.
--
-- Idempotente. Rollback: supabase/rollbacks/20261116110000_cot_form_r2_columnas.down.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------------
alter table public.quotations_db
  add column if not exists short_code text,
  add column if not exists client_is_minor boolean,
  add column if not exists preferred_date_from date,
  add column if not exists preferred_date_to date,
  add column if not exists preferred_location_type text,
  add column if not exists preferred_location_ref text,
  add column if not exists preferred_location_label text,
  add column if not exists preferred_location_city text,
  add column if not exists preferred_location_country text,
  add column if not exists preferred_location_studio_id uuid,
  add column if not exists preferred_location_from date,
  add column if not exists preferred_location_to date,
  add column if not exists reused_from_quote_id text;

alter table public.quotations_attachments
  add column if not exists note text,
  add column if not exists ai_generated boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotations_db_short_code_format_check') then
    alter table public.quotations_db
      add constraint quotations_db_short_code_format_check
      check (short_code is null or short_code ~ '^[2-9A-HJKMNP-Z]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotations_db_preferred_dates_check') then
    alter table public.quotations_db
      add constraint quotations_db_preferred_dates_check
      check (preferred_date_from is null or preferred_date_to is null or preferred_date_to >= preferred_date_from);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotations_db_preferred_location_type_check') then
    alter table public.quotations_db
      add constraint quotations_db_preferred_location_type_check
      check (preferred_location_type is null
             or preferred_location_type in ('artist_base', 'artist_location', 'studio_location', 'trip'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotations_db_preferred_location_text_check') then
    alter table public.quotations_db
      add constraint quotations_db_preferred_location_text_check
      check (char_length(coalesce(preferred_location_label, '')) <= 240
             and char_length(coalesce(preferred_location_ref, '')) <= 64
             and char_length(coalesce(preferred_location_city, '')) <= 120
             and char_length(coalesce(preferred_location_country, '')) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotations_db_preferred_location_studio_fkey') then
    alter table public.quotations_db
      add constraint quotations_db_preferred_location_studio_fkey
      foreign key (preferred_location_studio_id) references public.studios(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotations_attachments_note_length_check') then
    alter table public.quotations_attachments
      add constraint quotations_attachments_note_length_check
      check (note is null or char_length(note) <= 2000);
  end if;
end $$;

comment on column public.quotations_db.short_code is 'Código corto visible de la cotización (6 caracteres, único). El quote_id interno no cambia.';
comment on column public.quotations_db.client_is_minor is 'true si el cliente es menor de 18 años según client_birth_date (lo deriva el trigger).';
comment on column public.quotations_db.preferred_location_type is 'Sede elegida por el cliente: artist_base | artist_location | studio_location | trip.';
comment on column public.quotations_attachments.note is 'Comentario del cliente sobre esta imagen de referencia.';
comment on column public.quotations_attachments.ai_generated is 'Referencia generada con IA: solo referencial.';

-- ---------------------------------------------------------------------------
-- 2. Código corto: 6 caracteres de un alfabeto sin ambiguos (31 símbolos)
-- ---------------------------------------------------------------------------
-- En el esquema private (no expuesto por la API) y security definer: la
-- comprobación de unicidad ve todas las filas aunque el alta la haga un rol con
-- RLS. Los roles de la API la ejecutan solo a través del trigger.
create or replace function private.generate_quotation_short_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text;
  v_try integer := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * 31)::integer, 1);
    end loop;
    exit when not exists (select 1 from public.quotations_db q where q.short_code = v_code);
    v_try := v_try + 1;
    if v_try > 50 then
      raise exception 'No se pudo generar un código corto único para la cotización';
    end if;
  end loop;
  return v_code;
end;
$$;

revoke all on function private.generate_quotation_short_code() from public;
grant execute on function private.generate_quotation_short_code() to anon, authenticated, service_role;

-- Campos que mantiene el servidor. Los roles de la API (anon/authenticated:
-- cliente, artista dueño, soporte) no los cambian a mano. Sin security definer:
-- current_user tiene que ser el rol que escribe (igual que
-- fn_quotations_client_column_guard).
create or replace function public.fn_quotations_r2_server_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.short_code is null or new.short_code !~ '^[2-9A-HJKMNP-Z]{6}$'
       or current_user in ('anon', 'authenticated') then
      new.short_code := private.generate_quotation_short_code();
    end if;
    new.client_is_minor := case
      when new.client_birth_date is null then null
      else new.client_birth_date > (current_date - interval '18 years')::date
    end;
    return new;
  end if;

  if old.short_code is not null then
    new.short_code := old.short_code;
  elsif new.short_code is null or new.short_code !~ '^[2-9A-HJKMNP-Z]{6}$' then
    new.short_code := private.generate_quotation_short_code();
  end if;

  if new.client_birth_date is distinct from old.client_birth_date then
    new.client_is_minor := case
      when new.client_birth_date is null then null
      else new.client_birth_date > (current_date - interval '18 years')::date
    end;
  elsif current_user in ('anon', 'authenticated') then
    new.client_is_minor := old.client_is_minor;
  end if;

  if current_user in ('anon', 'authenticated') then
    new.reused_from_quote_id := old.reused_from_quote_id;
  end if;
  return new;
end;
$$;

-- Solo corre como trigger; EXECUTE queda como en las demás funciones de trigger
-- de quotations_db (el rol que escribe tiene que poder dispararla).

drop trigger if exists trg_quotations_r2_server_fields on public.quotations_db;
create trigger trg_quotations_r2_server_fields
  before insert or update on public.quotations_db
  for each row execute function public.fn_quotations_r2_server_fields();

-- ---------------------------------------------------------------------------
-- 3. Backfill (sin disparar triggers: no toca updated_at ni marca sincronías)
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;

do $$
declare
  r record;
begin
  for r in select id from public.quotations_db where short_code is null order by id loop
    update public.quotations_db
       set short_code = private.generate_quotation_short_code()
     where id = r.id;
  end loop;
end $$;

update public.quotations_db
   set client_is_minor = client_birth_date > (current_date - interval '18 years')::date
 where client_birth_date is not null
   and client_is_minor is null;

set local session_replication_role = origin;

create unique index if not exists quotations_db_short_code_key
  on public.quotations_db (short_code);

commit;
