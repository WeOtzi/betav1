-- Denuncias → tickets de soporte (16 nov 2026 · ronda 2, frente "denuncias", P33).
--
-- Los artistas denuncian cotizaciones (comentarios abusivos, fotos
-- inapropiadas, violencia, spam) y a otros artistas; los dueños y managers de
-- estudio denuncian a otros estudios (suplantación de identidad, robo de
-- propiedad intelectual, difamación). Cada denuncia abre un ticket en
-- support_tickets (kind 'denuncia', category 'reporte') y guarda el
-- expediente completo del denunciante y del denunciado en
-- support_ticket_reports.
--
--   1. support_tickets.kind admite 'denuncia'.
--   2. Tabla support_ticket_reports (un expediente por ticket). RLS: solo
--      soporte lee; nadie escribe con su JWT. El denunciado NUNCA se guarda
--      en support_tickets.counterpart_user_id (esa columna le daría lectura
--      del ticket por la policy support_tickets_participant_read).
--   3. RPC create_support_report(p_report jsonb), solo service_role: el
--      servidor (lib/routes/denuncias.js) autoriza al denunciante y arma el
--      expediente; la función deduplica denuncias abiertas iguales, aplica el
--      tope diario, valida los adjuntos contra Storage y crea ticket +
--      expediente en una sola transacción.
--
-- Idempotente y aditiva. Reversa:
-- supabase/rollbacks/20261116210000_support_ticket_reports.down.sql

begin;

-- 1. kind 'denuncia' ----------------------------------------------------------
alter table public.support_tickets
  drop constraint if exists support_tickets_kind_check;
alter table public.support_tickets
  add constraint support_tickets_kind_check
    check (kind = any (array['consulta'::text, 'disputa'::text, 'denuncia'::text]));

-- 2. Expediente de la denuncia ------------------------------------------------
create table if not exists public.support_ticket_reports (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  target_kind text not null,
  -- 'quotation:<id>' | 'artist:<user_id>' | 'studio:<studio_id>' (deduplicación)
  target_key text not null,
  reason text not null,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reporter_role text not null,
  reporter_studio_id uuid references public.studios(id) on delete set null,
  reported_user_id uuid references auth.users(id) on delete set null,
  reported_role text not null,
  reported_studio_id uuid references public.studios(id) on delete set null,
  quotation_id integer references public.quotations_db(id) on delete set null,
  quote_id text,
  evidence_links jsonb not null default '[]'::jsonb,
  dossier jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint support_ticket_reports_ticket_key unique (ticket_id),
  constraint support_ticket_reports_target_kind_check
    check (target_kind = any (array['quotation'::text, 'artist'::text, 'studio'::text])),
  constraint support_ticket_reports_target_key_check
    check (char_length(target_key) between 3 and 120),
  constraint support_ticket_reports_reason_check check (
    (target_kind = 'quotation'
      and reason = any (array['comentarios_abusivos'::text, 'fotos_inapropiadas'::text, 'violencia'::text, 'spam'::text]))
    or (target_kind = any (array['artist'::text, 'studio'::text])
      and reason = any (array['suplantacion_identidad'::text, 'robo_propiedad_intelectual'::text, 'difamacion'::text]))
  ),
  constraint support_ticket_reports_reporter_role_check
    check (reporter_role = any (array['artist'::text, 'studio_owner'::text, 'studio_manager'::text])),
  constraint support_ticket_reports_reported_role_check
    check (reported_role = any (array['client'::text, 'artist'::text, 'studio'::text])),
  constraint support_ticket_reports_links_check
    check (jsonb_typeof(evidence_links) = 'array' and jsonb_array_length(evidence_links) <= 5),
  constraint support_ticket_reports_dossier_check
    check (jsonb_typeof(dossier) = 'object' and octet_length(dossier::text) <= 600000)
);

comment on table public.support_ticket_reports is
  'Expediente de cada denuncia (ticket kind=denuncia): denunciante, denunciado, motivo, evidencia y contexto. Solo soporte.';

create index if not exists support_ticket_reports_reporter_idx
  on public.support_ticket_reports (reporter_user_id, created_at desc);
create index if not exists support_ticket_reports_target_idx
  on public.support_ticket_reports (target_key);
create index if not exists support_ticket_reports_reported_user_idx
  on public.support_ticket_reports (reported_user_id) where reported_user_id is not null;
create index if not exists support_ticket_reports_reported_studio_idx
  on public.support_ticket_reports (reported_studio_id) where reported_studio_id is not null;
create index if not exists support_ticket_reports_reporter_studio_idx
  on public.support_ticket_reports (reporter_studio_id) where reporter_studio_id is not null;
create index if not exists support_ticket_reports_quotation_idx
  on public.support_ticket_reports (quotation_id) where quotation_id is not null;
create index if not exists support_tickets_kind_status_idx
  on public.support_tickets (kind, status, last_activity_at desc);

alter table public.support_ticket_reports enable row level security;

drop policy if exists support_ticket_reports_support_read on public.support_ticket_reports;
create policy support_ticket_reports_support_read on public.support_ticket_reports
  for select to authenticated
  using ((select public.is_support_user()));

revoke all on table public.support_ticket_reports from public, anon, authenticated;
grant select on table public.support_ticket_reports to authenticated;
grant all on table public.support_ticket_reports to service_role;

-- 3. Alta de la denuncia (ticket + expediente) ---------------------------------
create or replace function public.create_support_report(p_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_daily_limit constant integer := 10;
  v_reporter uuid;
  v_kind text := p_report ->> 'target_kind';
  v_key text := p_report ->> 'target_key';
  v_reason text := p_report ->> 'reason';
  v_requester_role text := p_report ->> 'requester_role';
  v_subject text := pg_catalog.btrim(coalesce(p_report ->> 'subject', ''));
  v_description text := pg_catalog.btrim(coalesce(p_report ->> 'description', ''));
  v_priority text := coalesce(nullif(p_report ->> 'priority', ''), 'high');
  v_attachments jsonb := coalesce(p_report -> 'attachments', '[]'::jsonb);
  v_links jsonb := coalesce(p_report -> 'evidence_links', '[]'::jsonb);
  v_dossier jsonb := coalesce(p_report -> 'dossier', '{}'::jsonb);
  v_recent integer;
  v_existing record;
  v_item jsonb;
  v_path text;
  v_clean jsonb := '[]'::jsonb;
  v_ticket public.support_tickets%rowtype;
  v_report_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Solo el servidor de We Ötzi puede usar esta función.' using errcode = '42501';
  end if;
  if p_report is null or jsonb_typeof(p_report) <> 'object' then
    raise exception 'Faltan los datos de la denuncia.' using errcode = '22023';
  end if;

  v_reporter := nullif(p_report ->> 'reporter_user_id', '')::uuid;
  if v_reporter is null or v_kind is null or v_key is null or v_reason is null then
    raise exception 'Faltan los datos de la denuncia.' using errcode = '22023';
  end if;
  if v_requester_role is null or v_requester_role not in ('artist', 'client') then
    raise exception 'Rol del denunciante inválido.' using errcode = '22023';
  end if;
  if v_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Prioridad inválida.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_attachments) <> 'array' or jsonb_array_length(v_attachments) > 3 then
    raise exception 'Puedes adjuntar hasta 3 imágenes.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_links) <> 'array' or jsonb_array_length(v_links) > 5 then
    raise exception 'Puedes agregar hasta 5 enlaces.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_dossier) <> 'object' then
    raise exception 'Expediente inválido.' using errcode = '22023';
  end if;

  -- Una denuncia a la vez por denunciante: sin carreras en la deduplicación ni en el tope.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('support_report:' || v_reporter::text, 0));

  -- Deduplicación: misma persona, mismo objetivo y mismo motivo con el ticket todavía abierto.
  select r.id as report_id, t.id as ticket_id, t.ticket_number, t.status, t.created_at
    into v_existing
    from public.support_ticket_reports r
    join public.support_tickets t on t.id = r.ticket_id
   where r.reporter_user_id = v_reporter
     and r.target_key = v_key
     and r.reason = v_reason
     and t.status in ('open', 'in_progress', 'waiting_user')
   order by r.created_at desc
   limit 1;
  if found then
    return jsonb_build_object(
      'duplicate', true,
      'ticket_id', v_existing.ticket_id,
      'ticket_number', v_existing.ticket_number,
      'report_id', v_existing.report_id,
      'status', v_existing.status,
      'created_at', v_existing.created_at
    );
  end if;

  select count(*) into v_recent
    from public.support_ticket_reports r
   where r.reporter_user_id = v_reporter
     and r.created_at > now() - interval '24 hours';
  if v_recent >= v_daily_limit then
    raise exception 'Llegaste al máximo de denuncias por hoy. Si es urgente, escríbenos por el chat de soporte.'
      using errcode = 'WR429';
  end if;

  -- Adjuntos: solo archivos propios que existan en el bucket privado de soporte.
  for v_item in select * from jsonb_array_elements(v_attachments) loop
    v_path := v_item ->> 'path';
    if v_path is null
       or pg_catalog.left(v_path, 37) <> (v_reporter::text || '/')
       or pg_catalog.strpos(v_path, '..') > 0
       or char_length(v_path) > 400 then
      raise exception 'Adjunto inválido.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'support-attachments' and o.name = v_path
    ) then
      raise exception 'No encontramos una de las imágenes. Vuelve a subirla.' using errcode = '22023';
    end if;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'name', pg_catalog.left(coalesce(nullif(pg_catalog.btrim(v_item ->> 'name'), ''), 'archivo'), 120),
      'path', v_path,
      'size', case when (v_item ->> 'size') ~ '^[0-9]{1,12}$' then (v_item ->> 'size')::bigint else 0 end,
      'type', pg_catalog.left(coalesce(v_item ->> 'type', ''), 80)
    ));
  end loop;

  insert into public.support_tickets (
    kind, category, status, priority, subject, description,
    requester_user_id, requester_role, quotation_id, quote_id, attachments, page_context
  ) values (
    'denuncia', 'reporte', 'open', v_priority,
    pg_catalog.left(v_subject, 160), pg_catalog.left(v_description, 6000),
    v_reporter, v_requester_role,
    case when (p_report ->> 'quotation_id') ~ '^[0-9]{1,9}$' then (p_report ->> 'quotation_id')::integer else null end,
    nullif(pg_catalog.left(coalesce(p_report ->> 'quote_id', ''), 60), ''),
    v_clean,
    nullif(pg_catalog.left(coalesce(p_report ->> 'page_context', ''), 300), '')
  )
  returning * into v_ticket;

  insert into public.support_ticket_reports (
    ticket_id, target_kind, target_key, reason,
    reporter_user_id, reporter_role, reporter_studio_id,
    reported_user_id, reported_role, reported_studio_id,
    quotation_id, quote_id, evidence_links, dossier
  ) values (
    v_ticket.id, v_kind, v_key, v_reason,
    v_reporter, p_report ->> 'reporter_role', nullif(p_report ->> 'reporter_studio_id', '')::uuid,
    nullif(p_report ->> 'reported_user_id', '')::uuid, p_report ->> 'reported_role',
    nullif(p_report ->> 'reported_studio_id', '')::uuid,
    v_ticket.quotation_id, v_ticket.quote_id, v_links,
    v_dossier || jsonb_build_object('ticket', jsonb_build_object(
      'id', v_ticket.id, 'number', v_ticket.ticket_number, 'created_at', v_ticket.created_at))
  )
  returning id into v_report_id;

  return jsonb_build_object(
    'duplicate', false,
    'ticket_id', v_ticket.id,
    'ticket_number', v_ticket.ticket_number,
    'report_id', v_report_id,
    'status', v_ticket.status,
    'created_at', v_ticket.created_at
  );
end;
$function$;

comment on function public.create_support_report(jsonb) is
  'Crea el ticket (kind=denuncia) y su expediente. Solo service_role: la autorización la hace lib/routes/denuncias.js.';

revoke all on function public.create_support_report(jsonb) from public, anon, authenticated;
grant execute on function public.create_support_report(jsonb) to service_role;

commit;
