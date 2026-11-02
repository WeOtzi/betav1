-- =====================================================================
-- Invitaciones · mapa de estudios, detalle ampliado y "Escribir al estudio"
-- Figma final del flujo de artista (oct 2026), frames 2007:5792, 2007:5793,
-- 2007:5794 y 2007:5795 (ruta /artist/invitations).
--
-- 1) Perfil de trabajo del estudio (sección "Trabajar en este estudio"):
--    estilos, puestos, equipamiento, requisitos, comisión de referencia,
--    ventana para guests y si acepta consultas de artistas. Columnas nuevas
--    en public.studios: heredan su RLS (lectura pública, edición del dueño).
-- 2) RPC public.contact_studio_as_artist: abre (o reutiliza) un hilo del
--    Inbox unificado (categoría 'studios', context_type 'studio_contact',
--    context_id = studio_id) y publica el mensaje del artista. El estudio
--    responde desde el mismo hilo con send_inbox_message.
--
-- Aditiva e idempotente. NO aplicada (ver supabase/rollbacks/ para revertir).
-- =====================================================================

begin;

alter table public.studios
  add column if not exists specialty_styles text[] not null default array[]::text[],
  add column if not exists station_count integer,
  add column if not exists equipment text[] not null default array[]::text[],
  add column if not exists artist_requirements text[] not null default array[]::text[],
  add column if not exists default_revenue_split_pct numeric(5,2),
  add column if not exists accepts_guest_spots boolean not null default false,
  add column if not exists guest_window_start date,
  add column if not exists guest_window_end date,
  add column if not exists accepts_artist_inquiries boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'studios_station_count_range') then
    alter table public.studios
      add constraint studios_station_count_range
      check (station_count is null or station_count between 0 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'studios_default_split_range') then
    alter table public.studios
      add constraint studios_default_split_range
      check (default_revenue_split_pct is null or default_revenue_split_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'studios_guest_window_order') then
    alter table public.studios
      add constraint studios_guest_window_order
      check (guest_window_start is null or guest_window_end is null or guest_window_end >= guest_window_start);
  end if;
end;
$$;

comment on column public.studios.specialty_styles is 'Estilos que trabaja el estudio (detalle de estudio, Figma 2007:5794).';
comment on column public.studios.station_count is 'Cantidad de puestos de trabajo ("Espacios").';
comment on column public.studios.equipment is 'Equipamiento disponible para artistas invitados y residentes.';
comment on column public.studios.artist_requirements is 'Condiciones y requisitos publicados por el estudio.';
comment on column public.studios.default_revenue_split_pct is 'Porcentaje de referencia para el artista (modalidad "Comisión 50/50").';
comment on column public.studios.accepts_guest_spots is 'El estudio recibe guest spots aunque no tenga un spot publicado.';
comment on column public.studios.guest_window_start is 'Inicio de la ventana abierta para guests ("Fechas para guests").';
comment on column public.studios.guest_window_end is 'Fin de la ventana abierta para guests.';
comment on column public.studios.accepts_artist_inquiries is 'Si es false, el estudio no recibe mensajes de artistas desde We Ötzi.';

-- ---------------------------------------------------------------------
-- RPC: el artista escribe a un estudio.
-- ---------------------------------------------------------------------
create or replace function public.contact_studio_as_artist(
  p_studio_id uuid,
  p_reason text,
  p_message text,
  p_start_date date default null,
  p_end_date date default null,
  p_include_portfolio boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_studio public.studios%rowtype;
  v_username text;
  v_message text := btrim(coalesce(p_message, ''));
  v_reason_label text;
  v_portfolio text;
  v_body text;
  v_thread_id uuid;
  v_row public.inbox_messages%rowtype;
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('guest_spot', 'resident', 'other') then
    raise exception 'invalid contact reason' using errcode = '22023';
  end if;
  if char_length(v_message) < 20 then
    raise exception 'message must have at least 20 characters' using errcode = '22023';
  end if;
  if char_length(v_message) > 2000 then
    raise exception 'message is too long' using errcode = '22023';
  end if;
  if (p_start_date is null) <> (p_end_date is null) then
    raise exception 'both dates are required' using errcode = '22023';
  end if;
  if p_start_date is not null and (p_end_date < p_start_date or p_start_date < current_date) then
    raise exception 'invalid tentative dates' using errcode = '22023';
  end if;

  select * into v_studio from public.studios where id = p_studio_id;
  if not found or coalesce(v_studio.is_active, true) = false then
    raise exception 'studio not found' using errcode = 'P0002';
  end if;
  if v_studio.accepts_artist_inquiries = false then
    raise exception 'studio does not accept artist inquiries' using errcode = '42501';
  end if;
  if v_studio.user_id is null then
    raise exception 'studio has no account yet' using errcode = '42501';
  end if;
  if v_studio.user_id = v_uid then
    raise exception 'cannot contact your own studio' using errcode = '42501';
  end if;

  select username into v_username from public.artists_db where user_id = v_uid limit 1;
  if not found then
    raise exception 'artist profile required' using errcode = '42501';
  end if;

  -- Freno anti-spam: hasta 10 mensajes a estudios por hora.
  select count(*) into v_recent
  from public.inbox_messages m
  join public.inbox_threads t on t.id = m.thread_id
  where t.artist_user_id = v_uid
    and t.context_type = 'studio_contact'
    and m.sender_user_id = v_uid
    and m.created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'too many messages, try again later' using errcode = '54000';
  end if;

  v_reason_label := case p_reason
    when 'guest_spot' then 'Guest spot'
    when 'resident' then 'Artista residente'
    else 'Otra consulta'
  end;
  v_portfolio := case
    when coalesce(p_include_portfolio, false) and nullif(btrim(v_username), '') is not null
      then '/artist/profile?artist=' || v_username
  end;

  v_body := v_message;
  if p_start_date is not null then
    v_body := v_body || E'\n\nFechas tentativas: '
      || to_char(p_start_date, 'DD/MM/YYYY') || ' – ' || to_char(p_end_date, 'DD/MM/YYYY');
  end if;
  if v_portfolio is not null then
    v_body := v_body || E'\nPortfolio: ' || v_portfolio;
  end if;

  v_thread_id := public.ensure_domain_inbox_thread(
    v_uid, 'studios', 'studio_contact', v_studio.id,
    v_studio.user_id, v_studio.name,
    v_reason_label || ' · ' || v_studio.name,
    jsonb_build_object(
      'studio_id', v_studio.id,
      'studio_name', v_studio.name,
      'studio_slug', v_studio.slug,
      'city', v_studio.city,
      'reason', p_reason,
      'reason_label', v_reason_label,
      'start_date', p_start_date,
      'end_date', p_end_date,
      'include_portfolio', coalesce(p_include_portfolio, false),
      'portfolio_url', v_portfolio,
      'last_contact_at', now()
    ),
    null
  );

  insert into public.inbox_messages (thread_id, sender_user_id, sender_role, body, message_kind)
  values (v_thread_id, v_uid, 'artist', v_body, 'text')
  returning * into v_row;

  return jsonb_build_object(
    'thread_id', v_thread_id,
    'message_id', v_row.id,
    'contacted_at', v_row.created_at,
    'reason', p_reason,
    'reason_label', v_reason_label
  );
end;
$$;

revoke all on function public.contact_studio_as_artist(uuid, text, text, date, date, boolean) from public, anon;
grant execute on function public.contact_studio_as_artist(uuid, text, text, date, date, boolean) to authenticated, service_role;

comment on function public.contact_studio_as_artist(uuid, text, text, date, date, boolean) is
  'Artista → estudio: abre o reutiliza el hilo studio_contact del Inbox unificado y publica el mensaje (Figma 2007:5795).';

notify pgrst, 'reload schema';

commit;
