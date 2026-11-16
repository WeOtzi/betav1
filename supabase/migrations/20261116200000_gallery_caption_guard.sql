-- ============================================================================
-- Ronda 2 · frente "registro" (N3): pie de foto del portfolio.
-- ----------------------------------------------------------------------------
-- Cada ítem de artists_db.gallery_feed_items y studios.photo_feed_items puede
-- llevar un campo de texto `caption` (pie de foto): el de la publicación de
-- Instagram o el que escribe el artista en el registro / el panel.
--
-- No hay columnas nuevas (los feeds ya son jsonb). Esta migración agrega el
-- resguardo en la base: como el navegador escribe el feed completo por
-- PostgREST, un trigger BEFORE normaliza el `caption` de cada ítem sea quien
-- sea el que escriba:
--   · solo texto plano: sin caracteres de control ni marcas bidi;
--   · hasta 2200 caracteres (el tope de Instagram);
--   · vacío o no-texto → se quita la clave.
-- Misma regla que public/shared/js/gallery-caption.js (sanitizeCaption).
-- El resto del ítem no se toca. Idempotente.
-- Reversa: supabase/rollbacks/20261116200000_gallery_caption_guard.down.sql
-- ============================================================================

create or replace function public.wo_clean_gallery_caption(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    left(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              replace(replace(replace(coalesce(p_text, ''), E'\r\n', E'\n'), E'\r', E'\n'), E'\t', ' '),
              E'[\\u0001-\\u0009\\u000B-\\u001F\\u007F-\\u009F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]', '', 'g'),
            E'[ \\u00A0]+\\n', E'\n', 'g'),
          E'\\n{3,}', E'\n\n', 'g'),
        E' \n\t'),
      2200),
    '');
$$;

comment on function public.wo_clean_gallery_caption(text) is
  'Ronda 2 (registro): limpia un pie de foto del portfolio (texto plano, sin controles, hasta 2200 caracteres). NULL si queda vacío.';

create or replace function public.wo_normalize_feed_captions(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_items is null or jsonb_typeof(p_items) <> 'array' then p_items
    else coalesce((
      select jsonb_agg(
               case
                 when jsonb_typeof(feed.item) = 'object' and feed.item ? 'caption' then
                   case
                     when jsonb_typeof(feed.item -> 'caption') = 'string'
                          and public.wo_clean_gallery_caption(feed.item ->> 'caption') is not null
                       then jsonb_set(feed.item, '{caption}', to_jsonb(public.wo_clean_gallery_caption(feed.item ->> 'caption')))
                     else feed.item - 'caption'
                   end
                 else feed.item
               end
               order by feed.ord)
        from jsonb_array_elements(p_items) with ordinality as feed(item, ord)
    ), '[]'::jsonb)
  end;
$$;

comment on function public.wo_normalize_feed_captions(jsonb) is
  'Ronda 2 (registro): normaliza el campo caption de cada ítem de un feed de galería; no toca el resto del ítem.';

-- Funciones puras sin acceso a datos: las ejecuta el trigger con el rol de
-- quien escribe la fila.
revoke all on function public.wo_clean_gallery_caption(text) from public;
revoke all on function public.wo_normalize_feed_captions(jsonb) from public;
grant execute on function public.wo_clean_gallery_caption(text) to anon, authenticated, service_role;
grant execute on function public.wo_normalize_feed_captions(jsonb) to anon, authenticated, service_role;

create or replace function public.artists_db_gallery_caption_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.gallery_feed_items is not null
     and jsonb_typeof(new.gallery_feed_items) = 'array'
     and new.gallery_feed_items @? '$[*].caption' then
    new.gallery_feed_items := public.wo_normalize_feed_captions(new.gallery_feed_items);
  end if;
  return new;
end;
$$;

create or replace function public.studios_photo_caption_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.photo_feed_items is not null
     and jsonb_typeof(new.photo_feed_items) = 'array'
     and new.photo_feed_items @? '$[*].caption' then
    new.photo_feed_items := public.wo_normalize_feed_captions(new.photo_feed_items);
  end if;
  return new;
end;
$$;

revoke all on function public.artists_db_gallery_caption_guard() from public, anon, authenticated;
revoke all on function public.studios_photo_caption_guard() from public, anon, authenticated;

drop trigger if exists artists_db_gallery_caption_guard on public.artists_db;
create trigger artists_db_gallery_caption_guard
  before insert or update of gallery_feed_items on public.artists_db
  for each row execute function public.artists_db_gallery_caption_guard();

drop trigger if exists studios_photo_caption_guard on public.studios;
create trigger studios_photo_caption_guard
  before insert or update of photo_feed_items on public.studios
  for each row execute function public.studios_photo_caption_guard();
