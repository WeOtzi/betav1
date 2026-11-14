-- Reversa de 20261115160100_turnos_gcal_dirty.sql: quita el trigger de
-- Google Calendar de los apartados (la reversa de 20261115160000 igual se lo
-- lleva con el drop table).

begin;

do $$
begin
  if to_regclass('public.artist_booking_holds') is not null then
    execute 'drop trigger if exists trg_gcal_dirty on public.artist_booking_holds';
  end if;
end;
$$;

commit;
