-- Rollback de 20261116110000_cot_form_r2_columnas.sql
-- Antes: revertir 20261116110200 (vínculo de contacto) y 20261116110100 (intake),
-- que dependen de estas columnas. Se pierden los códigos cortos, la marca de
-- menor de edad, el rango de fechas, la sede elegida y las notas por imagen.

begin;

drop trigger if exists trg_quotations_r2_server_fields on public.quotations_db;
drop function if exists public.fn_quotations_r2_server_fields();
drop function if exists private.generate_quotation_short_code();

drop index if exists public.quotations_db_short_code_key;

alter table public.quotations_db
  drop constraint if exists quotations_db_short_code_format_check,
  drop constraint if exists quotations_db_preferred_dates_check,
  drop constraint if exists quotations_db_preferred_location_type_check,
  drop constraint if exists quotations_db_preferred_location_text_check,
  drop constraint if exists quotations_db_preferred_location_studio_fkey;

alter table public.quotations_attachments
  drop constraint if exists quotations_attachments_note_length_check;

alter table public.quotations_db
  drop column if exists short_code,
  drop column if exists client_is_minor,
  drop column if exists preferred_date_from,
  drop column if exists preferred_date_to,
  drop column if exists preferred_location_type,
  drop column if exists preferred_location_ref,
  drop column if exists preferred_location_label,
  drop column if exists preferred_location_city,
  drop column if exists preferred_location_country,
  drop column if exists preferred_location_studio_id,
  drop column if exists preferred_location_from,
  drop column if exists preferred_location_to,
  drop column if exists reused_from_quote_id;

alter table public.quotations_attachments
  drop column if exists note,
  drop column if exists ai_generated;

commit;
