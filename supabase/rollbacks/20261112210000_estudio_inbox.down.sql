-- Reversa de 20261112210000_estudio_inbox.sql
--
-- Restaura request_studio_invitation_changes a la versión viva previa (sin
-- publicar en el hilo) y elimina las RPC/helpers del inbox del estudio.
-- Los participantes 'studio' agregados por el backfill y los mensajes ya
-- escritos en hilos se conservan: son datos válidos del inbox unificado y
-- eliminarlos borraría conversaciones reales.

create or replace function public.request_studio_invitation_changes(p_membership_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_artist_id uuid;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 10 and 1000 then
    raise exception 'message must contain 10 to 1000 characters' using errcode = '22023';
  end if;

  select artist_user_id into v_artist_id
  from public.studio_artist_memberships
  where id = p_membership_id
    and artist_user_id = auth.uid()
    and status in ('pending_invite', 'pending_acceptance')
  for update;

  if not found then
    raise exception 'pending invitation not found' using errcode = '42501';
  end if;

  insert into public.studio_invitation_change_requests (
    membership_id, artist_user_id, message
  ) values (
    p_membership_id, v_artist_id, btrim(p_message)
  )
  on conflict (membership_id) where status = 'pending'
  do update set message = excluded.message, created_at = timezone('utc', now())
  returning id into v_request_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'membership_id', p_membership_id,
    'status', 'pending'
  );
end;
$$;

revoke all on function public.request_studio_invitation_changes(uuid, text) from public, anon;
grant execute on function public.request_studio_invitation_changes(uuid, text) to authenticated;

drop function if exists public.respond_studio_invitation_change_request(uuid, text, text, jsonb);
drop function if exists public.list_studio_invitation_change_requests(uuid);
drop function if exists public.open_studio_inbox_thread(uuid, uuid);
drop function if exists public.list_studio_inbox_threads(uuid);
drop function if exists private.studio_invitation_thread_id(uuid);
drop index if exists public.idx_inbox_threads_studio_ctx;
drop function if exists private.is_studio_owner(uuid);
drop function if exists private.inbox_thread_studio_id(text, uuid, jsonb);
drop function if exists private.studio_inbox_context_types();
