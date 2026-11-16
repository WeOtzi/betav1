-- Reversa de 20261116220000_quotations_guardas_vinculo_y_origen.sql.
-- Devuelve public.fn_quotations_client_column_guard a la definición anterior
-- (20261115130000_cot_form_rls_cierre.sql): el artista dueño vuelve a poder
-- cambiar client_user_id, source y quotation_medium de su cotización.
-- El trigger trg_a_quotations_client_column_guard no se toca.

begin;

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

comment on function public.fn_quotations_client_column_guard() is null;

commit;
