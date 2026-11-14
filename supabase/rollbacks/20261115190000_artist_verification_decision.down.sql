-- Reversa de 20261115190000_artist_verification_decision.sql.
-- Vuelve a la RPC de 2 argumentos sin historial, quita la cola por artista y la
-- solicitud por servidor, restaura las políticas abiertas de verification_history
-- y el guard anterior. Las filas de verification_history que ya se escribieron
-- quedan (son historial).

begin;

drop function if exists public.support_set_artist_verification_state(uuid, text, text);
drop function if exists public.request_artist_verification(uuid);
drop function if exists public.support_list_verification_requests(text, uuid);

create or replace function public.support_set_artist_verification_state(p_artist_user_id uuid, p_state text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state text;
begin
  if not coalesce(public.is_support_user(), false) then
    raise exception 'Solo soporte puede cambiar la verificación.' using errcode = '42501';
  end if;
  if p_state is null or p_state not in ('Yes', 'Denied', 'Requested', 'No') then
    raise exception 'Estado de verificación inválido.' using errcode = '22023';
  end if;
  update public.artists_db
     set verification_state = p_state
   where user_id = p_artist_user_id
  returning verification_state into v_state;
  if not found then
    raise exception 'No encontramos ese artista.' using errcode = '22023';
  end if;
  return v_state;
end;
$$;
grant execute on function public.support_set_artist_verification_state(uuid, text) to authenticated, service_role;

drop policy if exists verification_history_support_select on public.verification_history;
drop policy if exists verification_history_owner_select on public.verification_history;
drop policy if exists "Allow authenticated read on verification_history" on public.verification_history;
drop policy if exists "Allow authenticated insert on verification_history" on public.verification_history;
create policy "Allow authenticated read on verification_history"
  on public.verification_history for select to authenticated using (true);
create policy "Allow authenticated insert on verification_history"
  on public.verification_history for insert to authenticated with check (true);
grant select, insert, update, delete, truncate, references, trigger on table public.verification_history to anon, authenticated;
drop index if exists public.verification_history_artist_created_idx;

create or replace function public.guard_artist_privileged_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.wo_is_privileged_writer() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.verification_state, 'No') not in ('No', 'Requested') then
      raise exception 'La verificación la gestiona We Ötzi.' using errcode = '42501';
    end if;
    if coalesce(new.is_recommended, false) then
      raise exception 'La recomendación la gestiona We Ötzi.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.verification_state is distinct from old.verification_state then
    if not (new.verification_state = 'Requested'
            and coalesce(old.verification_state, 'No') in ('No', 'Denied', 'rejected')) then
      raise exception 'La verificación la gestiona We Ötzi.' using errcode = '42501';
    end if;
  end if;

  if new.is_recommended is distinct from old.is_recommended then
    raise exception 'La recomendación la gestiona We Ötzi.' using errcode = '42501';
  end if;

  return new;
end;
$$;

commit;
