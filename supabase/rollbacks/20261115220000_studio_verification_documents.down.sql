-- Reversa de 20261115220000_studio_verification_documents.sql.
-- Restaura decide_studio_verification como en 20261102120000 (lógica propia,
-- sin el helper privado), borra las RPC nuevas, las políticas del bucket y las
-- columnas. El bucket `studio-verification` solo se borra si está vacío: si ya
-- tiene archivos, vacialo antes desde Storage (son documentos de identidad).

begin;

create or replace function public.decide_studio_verification(p_request_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_request public.studio_verification_requests%rowtype;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_now timestamptz := timezone('utc', now());
begin
  if not public.is_support_user() then raise exception 'Solo soporte de We Ötzi decide verificaciones.' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Decisión no válida.' using errcode = '22023'; end if;
  if p_decision = 'reject' and (v_note is null or char_length(v_note) < 3) then
    raise exception 'Contale al estudio por qué no aprobamos la verificación.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'La nota admite hasta 1000 caracteres.' using errcode = '22023'; end if;
  select * into v_request from public.studio_verification_requests r where r.id = p_request_id for update;
  if not found then raise exception 'Solicitud no encontrada.' using errcode = 'P0002'; end if;
  if v_request.status <> 'pending' then raise exception 'La solicitud ya fue resuelta.' using errcode = '23514'; end if;
  update public.studio_verification_requests r
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      decided_at = v_now, decided_by = auth.uid(), decision_note = v_note, updated_at = v_now
  where r.id = p_request_id;
  if p_decision = 'approve' then
    update public.studios s set is_verified = true, verification_status = 'verified', verified_at = v_now,
        verification_required = false, verification_reason = null
    where s.id = v_request.studio_id;
  else
    update public.studios s set is_verified = false, verification_status = 'rejected', verified_at = null
    where s.id = v_request.studio_id;
  end if;
  return pg_catalog.jsonb_build_object('id', p_request_id, 'studio_id', v_request.studio_id,
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end);
end;
$function$;

drop function if exists public.revoke_studio_verification_as(uuid, text, uuid);
drop function if exists public.decide_studio_verification_as(uuid, text, text, uuid);
drop function if exists private.apply_studio_verification_decision(uuid, text, text, uuid);
drop function if exists public.submit_studio_verification(uuid, jsonb);

drop policy if exists studio_verification_owner_insert on storage.objects;
drop policy if exists studio_verification_owner_select on storage.objects;
drop policy if exists studio_verification_support_select on storage.objects;
do $$
begin
  delete from storage.buckets b
  where b.id = 'studio-verification'
    and not exists (select 1 from storage.objects o where o.bucket_id = 'studio-verification');
exception when others then
  -- Algunas versiones de Storage bloquean el DELETE directo: borrarlo desde el panel.
  raise notice 'No se pudo borrar el bucket studio-verification: %', sqlerrm;
end $$;

drop index if exists public.studio_verification_requests_location_idx;
alter table public.studio_verification_requests
  drop constraint if exists studio_verification_requests_legal_name_len,
  drop constraint if exists studio_verification_requests_responsible_role_len,
  drop constraint if exists studio_verification_requests_responsible_contact_len,
  drop constraint if exists studio_verification_requests_documents_shape,
  drop column if exists documents,
  drop column if exists location_id,
  drop column if exists responsible_contact,
  drop column if exists responsible_role,
  drop column if exists legal_name;

commit;
