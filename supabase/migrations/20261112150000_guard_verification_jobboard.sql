-- Guardas de integridad (ronda 3, 12 nov 2026).
--
-- 1) artists_db: la policy "Artists can update own record" no tiene with_check,
--    así que un artista podía ponerse verification_state = 'Yes' o
--    is_recommended = true. Solo soporte / service_role los cambian; el artista
--    solo puede pedir la verificación ('Requested').
-- 2) artist_verification_documents: el INSERT del dueño no restringía status;
--    un documento nuevo del artista entra siempre 'pendiente' y sin revisión.
-- 3) job_board_applications: el artista podía mover su propuesta a cualquier
--    estado (incluido 'accepted') y el cliente aceptar sin pasar por
--    POST /api/job-board/accept-application. Ahora: artista → solo 'withdrawn'
--    (desde pending/viewed) y editar texto/precio mientras esté pending;
--    cliente del pedido → solo 'viewed' o 'rejected'. 'accepted' queda para el
--    servidor (service_role).
--
-- Aditiva e idempotente. Reversa: supabase/rollbacks/20261112150000_guard_verification_jobboard.down.sql

create or replace function public.wo_is_privileged_writer()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select current_user in ('postgres', 'supabase_admin', 'service_role')
      or coalesce(auth.role(), '') = 'service_role'
      or coalesce(public.is_support_user(), false);
$$;

-- 1) artists_db -------------------------------------------------------------
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
    -- El artista solo puede pedir la verificación (desde No / Denied / vacío).
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

drop trigger if exists trg_guard_artist_privileged_fields on public.artists_db;
create trigger trg_guard_artist_privileged_fields
  before insert or update on public.artists_db
  for each row execute function public.guard_artist_privileged_fields();

-- 2) artist_verification_documents -----------------------------------------
create or replace function public.guard_artist_verification_document()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.wo_is_privileged_writer() then
    return new;
  end if;
  new.status := 'pendiente';
  new.reviewed_at := null;
  new.reviewer_notes := null;
  return new;
end;
$$;

drop trigger if exists trg_guard_artist_verification_document on public.artist_verification_documents;
create trigger trg_guard_artist_verification_document
  before insert on public.artist_verification_documents
  for each row execute function public.guard_artist_verification_document();

-- 3) job_board_applications -------------------------------------------------
create or replace function public.guard_job_board_application_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_client boolean;
begin
  if public.wo_is_privileged_writer() then
    return new;
  end if;

  if new.request_id is distinct from old.request_id
     or new.artist_id is distinct from old.artist_id
     or new.created_at is distinct from old.created_at then
    raise exception 'No se puede cambiar el pedido ni el artista de una propuesta.' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.job_board_requests r
    where r.id = old.request_id and r.client_user_id = v_uid
  ) into v_is_client;

  if v_uid is not null and v_uid = old.artist_id then
    if new.status is distinct from old.status then
      if not (new.status = 'withdrawn' and old.status in ('pending', 'viewed')) then
        raise exception 'Solo podés retirar tu propuesta.' using errcode = '42501';
      end if;
      return new;
    end if;
    -- Editar el contenido solo mientras nadie decidió.
    if old.status <> 'pending' and (
         new.message is distinct from old.message
      or new.estimated_price is distinct from old.estimated_price
      or new.estimated_sessions is distinct from old.estimated_sessions
      or new.estimated_duration is distinct from old.estimated_duration
      or new.availability_note is distinct from old.availability_note
      or new.portfolio_links is distinct from old.portfolio_links) then
      raise exception 'La propuesta ya no se puede editar.' using errcode = '42501';
    end if;
    if new.decided_at is distinct from old.decided_at then
      raise exception 'La propuesta ya no se puede editar.' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_is_client then
    if new.status is distinct from old.status
       and not (new.status in ('viewed', 'rejected') and old.status in ('pending', 'viewed')) then
      raise exception 'Para aceptar una propuesta usá el flujo de aceptación.' using errcode = '42501';
    end if;
    if row(new.message, new.estimated_price, new.estimated_sessions, new.estimated_duration,
           new.availability_note, new.portfolio_links, new.estimated_price_usd, new.estimated_price_eur)
       is distinct from
       row(old.message, old.estimated_price, old.estimated_sessions, old.estimated_duration,
           old.availability_note, old.portfolio_links, old.estimated_price_usd, old.estimated_price_eur) then
      raise exception 'No podés editar la propuesta del artista.' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Sin permiso para modificar esta propuesta.' using errcode = '42501';
end;
$$;

drop trigger if exists trg_guard_job_board_application_update on public.job_board_applications;
create trigger trg_guard_job_board_application_update
  before update on public.job_board_applications
  for each row execute function public.guard_job_board_application_update();
