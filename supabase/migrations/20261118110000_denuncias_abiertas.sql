-- ============================================================================
-- Denuncias abiertas (18 nov 2026 · 2.7.0, plan de identidad, suplantación y
-- plagio, fase 1 · equipo T1).
-- ============================================================================
-- Cualquier persona con sesión (cliente, artista o quien administra un
-- estudio) puede denunciar el perfil de un artista o un estudio. Cambios:
--
--   1. support_ticket_reports.reporter_role admite 'client'.
--   2. Motivos de perfil nuevos: 'plagio_diseno' y 'estafa' (además de
--      suplantacion_identidad, robo_propiedad_intelectual y difamacion).
--   3. Columna claimed_instagram: el Instagram que reclama quien dice ser la
--      persona o el estudio suplantado (sin @, en minúsculas). Sirve para subir
--      la prioridad cuando esa persona valida su Instagram después
--      (DenunciasRepo.bumpClaimantReports). Índice parcial.
--   4. create_support_report: tope de 5 denuncias por denunciante en 24 horas
--      (antes 10) y guarda claimed_instagram. Se parte de la definición VIVA
--      (md5 22bed5f7b623ed500e8b7c303a759e20, igual a la de
--      20261116210000_support_ticket_reports.sql): si la función viva es otra,
--      la migración falla sin tocar nada. Todo lo demás queda igual
--      (service_role, lock por denunciante, deduplicación por denunciante +
--      objetivo + motivo con ticket abierto, validación de adjuntos).
--   5. patch_support_report_dossier: cambia una sola clave del expediente en
--      una sentencia (con compare-and-set opcional), para que el aviso al
--      denunciado, el reclamo confirmado y las imágenes sumadas no se pisen.
--
-- La tabla estaba vacía al escribir esta migración (0 filas): ampliar los
-- CHECK no afecta datos existentes.
-- Reversa: supabase/rollbacks/20261118110000_denuncias_abiertas.down.sql
-- ============================================================================

begin;

-- 0. La función viva tiene que ser la conocida (o esta misma, si se re-ejecuta).
do $guard$
declare
  def text;
begin
  select pg_get_functiondef('public.create_support_report(jsonb)'::regprocedure) into def;
  if position('claimed_instagram' in def) > 0 then
    raise notice 'create_support_report ya guarda claimed_instagram: se vuelve a definir igual';
  elsif md5(def) <> '22bed5f7b623ed500e8b7c303a759e20' then
    raise exception 'create_support_report viva difiere de 20261116210000 (md5 %): revisar antes de aplicar', md5(def);
  end if;
end
$guard$;

-- 1. Rol del denunciante: también clientes ------------------------------------
alter table public.support_ticket_reports
  drop constraint if exists support_ticket_reports_reporter_role_check;
alter table public.support_ticket_reports
  add constraint support_ticket_reports_reporter_role_check
    check (reporter_role = any (array['artist'::text, 'studio_owner'::text, 'studio_manager'::text, 'client'::text]));

-- 2. Motivos de perfil nuevos -------------------------------------------------
alter table public.support_ticket_reports
  drop constraint if exists support_ticket_reports_reason_check;
alter table public.support_ticket_reports
  add constraint support_ticket_reports_reason_check check (
    (target_kind = 'quotation'
      and reason = any (array['comentarios_abusivos'::text, 'fotos_inapropiadas'::text, 'violencia'::text, 'spam'::text]))
    or (target_kind = any (array['artist'::text, 'studio'::text])
      and reason = any (array['suplantacion_identidad'::text, 'plagio_diseno'::text, 'robo_propiedad_intelectual'::text,
                              'difamacion'::text, 'estafa'::text]))
  );

-- 3. Instagram reclamado por la persona suplantada ----------------------------
alter table public.support_ticket_reports
  add column if not exists claimed_instagram text;
alter table public.support_ticket_reports
  drop constraint if exists support_ticket_reports_claimed_instagram_check;
alter table public.support_ticket_reports
  add constraint support_ticket_reports_claimed_instagram_check
    check (claimed_instagram is null or claimed_instagram ~ '^[a-z0-9._]{1,30}$');

comment on column public.support_ticket_reports.claimed_instagram is
  'Instagram (sin @, minúsculas) que reclama el denunciante como propio en una denuncia de suplantación o plagio.';

create index if not exists support_ticket_reports_claimed_instagram_idx
  on public.support_ticket_reports (reporter_user_id, claimed_instagram)
  where claimed_instagram is not null;

-- 4. Alta de la denuncia: tope 5 y claimed_instagram ---------------------------
create or replace function public.create_support_report(p_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_daily_limit constant integer := 5;
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
  v_claimed text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_report ->> 'claimed_instagram', ''))), '');
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
  if v_claimed is not null and v_claimed !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'Revisa el usuario de Instagram.' using errcode = '22023';
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
    quotation_id, quote_id, evidence_links, dossier, claimed_instagram
  ) values (
    v_ticket.id, v_kind, v_key, v_reason,
    v_reporter, p_report ->> 'reporter_role', nullif(p_report ->> 'reporter_studio_id', '')::uuid,
    nullif(p_report ->> 'reported_user_id', '')::uuid, p_report ->> 'reported_role',
    nullif(p_report ->> 'reported_studio_id', '')::uuid,
    v_ticket.quotation_id, v_ticket.quote_id, v_links,
    v_dossier || jsonb_build_object('ticket', jsonb_build_object(
      'id', v_ticket.id, 'number', v_ticket.ticket_number, 'created_at', v_ticket.created_at)),
    v_claimed
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
  'Crea el ticket (kind=denuncia) y su expediente. Tope de 5 denuncias por denunciante en 24 h. Solo service_role: la autorización la hace lib/routes/denuncias.js.';

revoke all on function public.create_support_report(jsonb) from public, anon, authenticated;
grant execute on function public.create_support_report(jsonb) to service_role;

-- 5. Expediente: escritura por clave -------------------------------------------
-- El servidor cambia UNA clave de primer nivel del expediente (reported_notice,
-- claim, evidence) en una sola sentencia, sin reescribir el objeto entero: dos
-- escrituras a la vez sobre claves distintas no se pisan. Con p_check = true
-- solo escribe si la clave vale p_expect (null = la clave no está): sirve de
-- reserva (aviso al denunciado una sola vez) y de compare-and-set para listas.
-- p_value null quita la clave. Devuelve el expediente nuevo, o null si no
-- escribió (no existe la denuncia o la clave ya no valía p_expect).
create or replace function public.patch_support_report_dossier(
  p_report_id uuid,
  p_key text,
  p_value jsonb default null,
  p_check boolean default false,
  p_expect jsonb default null
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_dossier jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Solo el servidor de We Ötzi puede usar esta función.' using errcode = '42501';
  end if;
  if p_report_id is null or p_key is null or p_key !~ '^[a-z_]{1,40}$' or p_key = 'ticket' then
    raise exception 'Clave del expediente inválida.' using errcode = '22023';
  end if;

  update public.support_ticket_reports r
     set dossier = case
           when p_value is null or p_value = 'null'::jsonb then r.dossier - p_key
           else r.dossier || jsonb_build_object(p_key, p_value)
         end
   where r.id = p_report_id
     and (not coalesce(p_check, false)
          or coalesce(r.dossier -> p_key, 'null'::jsonb) = coalesce(p_expect, 'null'::jsonb))
  returning r.dossier into v_dossier;

  return v_dossier;
end;
$function$;

comment on function public.patch_support_report_dossier(uuid, text, jsonb, boolean, jsonb) is
  'Cambia una clave del expediente de una denuncia sin reescribir el resto (opcionalmente solo si vale p_expect). Solo service_role.';

revoke all on function public.patch_support_report_dossier(uuid, text, jsonb, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.patch_support_report_dossier(uuid, text, jsonb, boolean, jsonb) to service_role;

commit;
