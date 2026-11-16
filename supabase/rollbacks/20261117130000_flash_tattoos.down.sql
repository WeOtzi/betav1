-- Reversa de 20261117130000_flash_tattoos.sql (Flash Tattoos).
-- Quita los triggers y las funciones de disponibilidad, de reserva única, de la
-- galería y de guarda; devuelve save_web_quotation a su versión sin
-- flash_snapshot (reemplazos inversos sobre la definición VIVA, antes de borrar
-- la columna); quita la columna flash_snapshot y vuelve al CHECK de origen sin
-- 'flash'. El CHECK se crea NOT VALID para no fallar si ya hay cotizaciones de
-- flash: esas filas quedan (con su origen), pero no se pueden crear nuevas. Los
-- datos "flash" dentro de artists_db.gallery_feed_items quedan como están (son
-- una clave más del jsonb).

begin;

drop trigger if exists trg_artists_flash_keep_reserved on public.artists_db;
drop trigger if exists trg_quotations_flash_unique_reservation on public.quotations_db;
drop trigger if exists trg_quotations_flash_availability on public.quotations_db;
drop trigger if exists trg_quotations_flash_guard on public.quotations_db;

drop function if exists public.fn_artists_flash_keep_reserved();
drop function if exists public.fn_quotations_flash_unique_reservation();
drop function if exists public.fn_quotations_flash_availability();
drop function if exists public.fn_flash_set_available(uuid, text, boolean);
drop function if exists public.fn_quotations_flash_guard();

-- save_web_quotation sin flash_snapshot: cada reemplazo inverso tiene que
-- encontrar exactamente una ocurrencia; si la función ya no la guarda, no se toca.
do $rollback$
declare
  v_def text;
  v_from text[] := array[
    E'artist_studio_name, artist_session_cost_amount, quotation_medium, source, flash_snapshot\n  )',
    E'q.artist_studio_name, q.artist_session_cost_amount, q.quotation_medium, q.source, q.flash_snapshot\n  )',
    E'    source = excluded.source,\n    flash_snapshot = coalesce(excluded.flash_snapshot, quotations_db.flash_snapshot),\n    updated_at = now()'
  ];
  v_to text[] := array[
    E'artist_studio_name, artist_session_cost_amount, quotation_medium, source\n  )',
    E'q.artist_studio_name, q.artist_session_cost_amount, q.quotation_medium, q.source\n  )',
    E'    source = excluded.source,\n    updated_at = now()'
  ];
  v_count integer;
  i integer;
begin
  v_def := pg_get_functiondef('public.save_web_quotation(jsonb, jsonb)'::regprocedure);
  if position('flash_snapshot' in v_def) = 0 then
    raise notice 'save_web_quotation no guarda flash_snapshot: sin cambios.';
    return;
  end if;
  for i in 1 .. array_length(v_from, 1) loop
    v_count := (length(v_def) - length(replace(v_def, v_from[i], ''))) / length(v_from[i]);
    if v_count <> 1 then
      raise exception 'save_web_quotation: el reemplazo inverso % encontró % ocurrencias (se esperaba 1).', i, v_count;
    end if;
    v_def := replace(v_def, v_from[i], v_to[i]);
  end loop;
  if position('flash_snapshot' in v_def) > 0 then
    raise exception 'save_web_quotation sigue mencionando flash_snapshot después de los reemplazos inversos.';
  end if;
  execute v_def;
end;
$rollback$;

drop index if exists public.quotations_db_flash_item_idx;
alter table public.quotations_db
  drop constraint if exists quotations_db_flash_snapshot_check;
alter table public.quotations_db
  drop column if exists flash_snapshot;

alter table public.quotations_db
  drop constraint if exists quotations_db_source_check;
alter table public.quotations_db
  add constraint quotations_db_source_check
  check (source is null or source = any (array[
    'direct'::text, 'job_board'::text, 'recommendation'::text, 'web_chat'::text,
    'manual'::text, 'prequote'::text
  ])) not valid;

notify pgrst, 'reload schema';

commit;
