-- Tests de M3 (20261030202000_studio_agenda_inventory) y M4
-- (20261030203000_studio_finance). Correr como postgres DESPUÉS de la cadena
-- 20261030200000 … 20261030204000, en la misma transacción. Las identidades,
-- estudios y filas son fixtures "QA ROLLBACK" y todo se revierte al final.
-- Cubre: fuentes de ocupado (agenda personal con recurrencia semanal,
-- cotizaciones, otros estudios), RPCs de agenda y sus rechazos cruzados,
-- trigger de citas (autoría, no_show, reprogramación, reparto al completar),
-- inventario de materiales por artista, libro de finanzas y storage.
begin;
reset role;
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------
-- Fixtures (postgres, sin JWT)
-- ---------------------------------------------------------------------
do $$
declare
  owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid(); support_id uuid := gen_random_uuid();
  ax uuid := gen_random_uuid(); az uuid := gen_random_uuid(); aw uuid := gen_random_uuid(); av uuid := gen_random_uuid();
  au uuid := gen_random_uuid(); am uuid := gen_random_uuid(); aq uuid := gen_random_uuid(); ay uuid := gen_random_uuid();
  t0 timestamptz := date_trunc('day', now()) + interval '400 days';
  sid_a uuid; sid_b uuid; loc_a uuid; loc_b uuid; sup_a uuid; sup_b uuid;
  mx_a uuid; mx_b uuid; mz uuid; mw uuid; mv uuid; mu uuid; mm uuid; mq uuid; my_b uuid;
  cz uuid; cw uuid; cv uuid; cm uuid;
  qid integer; i1 uuid; i2 uuid; ib uuid; ba1 uuid; bb1 uuid;
begin
  insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select u.id, 'authenticated', 'authenticated', 'qa-aif-' || u.tag || '-' || u.id || '@example.invalid', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from (values (owner_a, 'owner-a'), (owner_b, 'owner-b'), (support_id, 'support'), (ax, 'artist-x'), (az, 'artist-z'),
               (aw, 'artist-w'), (av, 'artist-v'), (au, 'artist-u'), (am, 'artist-m'), (aq, 'artist-q'), (ay, 'artist-y')) as u(id, tag);
  insert into public.support_users_db(user_id, email, full_name, role, is_active)
  values (support_id, 'qa-aif-support-' || support_id || '@example.invalid', 'QA ROLLBACK soporte', 'support', true);
  insert into public.artists_db(user_id, name)
  select a.id, 'QA ROLLBACK artista ' || a.tag
  from (values (ax, 'X'), (az, 'Z'), (aw, 'W'), (av, 'V'), (au, 'U'), (am, 'M'), (aq, 'Q'), (ay, 'Y')) as a(id, tag)
  on conflict (user_id) do nothing;

  insert into public.studios(user_id, name, normalized_name, slug)
  values (owner_a, 'QA ROLLBACK studio A', 'QA-AIF-A-' || owner_a, 'qa-aif-a-' || owner_a) returning id into sid_a;
  insert into public.studios(user_id, name, normalized_name, slug)
  values (owner_b, 'QA ROLLBACK studio B', 'QA-AIF-B-' || owner_b, 'qa-aif-b-' || owner_b) returning id into sid_b;
  insert into public.studio_locations(studio_id, label) values (sid_a, 'QA ROLLBACK sede A') returning id into loc_a;
  insert into public.studio_locations(studio_id, label) values (sid_b, 'QA ROLLBACK sede B') returning id into loc_b;
  insert into public.studio_suppliers(studio_id, name) values (sid_a, 'QA ROLLBACK proveedor A') returning id into sup_a;
  insert into public.studio_suppliers(studio_id, name) values (sid_b, 'QA ROLLBACK proveedor B') returning id into sup_b;

  insert into public.studio_artist_memberships(studio_id, artist_user_id, status, role, revenue_split_pct, started_at)
  values (sid_a, ax, 'active', 'resident', 60, now() - interval '90 days') returning id into mx_a;
  insert into public.studio_artist_memberships(studio_id, artist_user_id, status, role, started_at)
  values (sid_b, ax, 'active', 'resident', now() - interval '90 days') returning id into mx_b;
  insert into public.studio_artist_memberships(studio_id, artist_user_id, status, role, revenue_split_pct, started_at)
  values (sid_a, az, 'active', 'resident', 50, now() - interval '90 days') returning id into mz;
  insert into public.studio_artist_memberships(studio_id, artist_user_id, status, role, started_at)
  values (sid_a, aw, 'active', 'resident', now() - interval '90 days') returning id into mw;
  insert into public.studio_artist_memberships(studio_id, artist_user_id, status, role, revenue_split_pct, started_at)
  values (sid_a, av, 'active', 'resident', 40, now() - interval '90 days') returning id into mv;
  insert into public.studio_artist_memberships(studio_id, artist_user_id, status, role, started_at)
  values (sid_a, au, 'active', 'resident', now() - interval '90 days') returning id into mu;
  insert into public.studio_artist_memberships(studio_id, artist_user_id, status, role, started_at)
  values (sid_a, am, 'active', 'resident', now() - interval '90 days') returning id into mm;
  insert into public.studio_artist_memberships(studio_id, artist_user_id, status, role, started_at)
  values (sid_a, aq, 'active', 'resident', now() - interval '90 days') returning id into mq;
  insert into public.studio_artist_memberships(studio_id, artist_user_id, status, role, started_at)
  values (sid_b, ay, 'active', 'resident', now() - interval '90 days') returning id into my_b;

  -- Contratos firmados (M2) para el reparto al completar.
  insert into public.studio_contracts(studio_id, contract_number, version, artist_user_id, membership_id, origin, role,
    compensation_model, artist_percentage, start_date, status, sent_at, studio_signer_name, studio_signed_by, studio_signed_at,
    artist_signer_name, artist_signed_at, terms_snapshot, terms_hash, created_by)
  values (sid_a, 'C-2026-9901', 1, az, mz, 'manual', 'resident', 'percentage', 70, current_date - 30, 'signed', now() - interval '31 days',
    'QA ROLLBACK dueño A', owner_a, now() - interval '31 days', 'QA ROLLBACK artista Z', now() - interval '30 days', jsonb_build_object('qa', true), encode(extensions.digest('QA ROLLBACK', 'sha256'), 'hex'), owner_a)
  returning id into cz;
  insert into public.studio_contracts(studio_id, contract_number, version, artist_user_id, membership_id, origin, role,
    compensation_model, fixed_amount, fixed_currency, fixed_period, fixed_payer, start_date, status, sent_at, studio_signer_name,
    studio_signed_by, studio_signed_at, artist_signer_name, artist_signed_at, terms_snapshot, terms_hash, created_by)
  values (sid_a, 'C-2026-9902', 1, aw, mw, 'manual', 'resident', 'fixed', 1000, 'ARS', 'monthly', 'artist_to_studio', current_date - 30, 'signed',
    now() - interval '31 days', 'QA ROLLBACK dueño A', owner_a, now() - interval '31 days', 'QA ROLLBACK artista W', now() - interval '30 days',
    jsonb_build_object('qa', true), encode(extensions.digest('QA ROLLBACK', 'sha256'), 'hex'), owner_a)
  returning id into cw;
  insert into public.studio_contracts(studio_id, contract_number, version, artist_user_id, membership_id, origin, role,
    compensation_model, fixed_amount, fixed_currency, fixed_period, fixed_payer, start_date, status, sent_at, studio_signer_name,
    studio_signed_by, studio_signed_at, artist_signer_name, artist_signed_at, terms_snapshot, terms_hash, created_by)
  values (sid_a, 'C-2026-9903', 1, av, mv, 'manual', 'resident', 'fixed', 500, 'ARS', 'monthly', 'studio_to_artist', current_date - 30, 'signed',
    now() - interval '31 days', 'QA ROLLBACK dueño A', owner_a, now() - interval '31 days', 'QA ROLLBACK artista V', now() - interval '30 days',
    jsonb_build_object('qa', true), encode(extensions.digest('QA ROLLBACK', 'sha256'), 'hex'), owner_a)
  returning id into cv;
  insert into public.studio_contracts(studio_id, contract_number, version, artist_user_id, membership_id, origin, role,
    compensation_model, artist_percentage, fixed_amount, fixed_currency, fixed_period, fixed_payer, start_date, status, sent_at,
    studio_signer_name, studio_signed_by, studio_signed_at, artist_signer_name, artist_signed_at, terms_snapshot, terms_hash, created_by)
  values (sid_a, 'C-2026-9904', 1, am, mm, 'manual', 'resident', 'mixed', 55, 200, 'ARS', 'weekly', 'artist_to_studio', current_date - 30, 'signed',
    now() - interval '31 days', 'QA ROLLBACK dueño A', owner_a, now() - interval '31 days', 'QA ROLLBACK artista M', now() - interval '30 days',
    jsonb_build_object('qa', true), encode(extensions.digest('QA ROLLBACK', 'sha256'), 'hex'), owner_a)
  returning id into cm;
  update public.studio_artist_memberships set current_contract_id = cz where id = mz;
  update public.studio_artist_memberships set current_contract_id = cw where id = mw;
  update public.studio_artist_memberships set current_contract_id = cv where id = mv;
  update public.studio_artist_memberships set current_contract_id = cm where id = mm;

  -- Agenda personal del artista X: semanal bloqueante (4 ocurrencias), una
  -- disponibilidad (no bloquea) y una cancelada (no bloquea).
  insert into public.artist_calendar_events(artist_user_id, event_type, title, starts_at, ends_at, status, recurrence_rule, recurrence_until)
  values (ax, 'personal', 'QA ROLLBACK semanal', t0 + interval '10 hours', t0 + interval '12 hours', 'scheduled', 'weekly', (t0 + interval '21 days')::date),
         (ax, 'availability', 'QA ROLLBACK disponible', t0 + interval '1 day 10 hours', t0 + interval '1 day 12 hours', 'scheduled', 'none', null),
         (ax, 'personal', 'QA ROLLBACK cancelado', t0 + interval '2 days 10 hours', t0 + interval '2 days 12 hours', 'cancelled', 'none', null);
  -- Sesiones de cotización: una vigente (duración null = 1 h) y una cancelada.
  insert into public.quotations_db(artist_id) values (ax) returning id into qid;
  insert into public.quotation_sessions(quotation_id, session_date, duration_hours, status)
  values (qid, t0 + interval '3 days 14 hours', null, 'scheduled'),
         (qid, t0 + interval '4 days 14 hours', 2, 'cancelled');
  -- Citas del artista X en el estudio B (una confirmada, una cancelada) y en A.
  insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at)
  values (sid_b, ax, 'QA ROLLBACK cliente B', t0 + interval '5 days 15 hours', t0 + interval '5 days 16 hours') returning id into bb1;
  insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at, status)
  values (sid_b, ax, 'QA ROLLBACK cliente B cancelado', t0 + interval '6 days 15 hours', t0 + interval '6 days 16 hours', 'cancelled');
  insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at)
  values (sid_a, ax, 'QA ROLLBACK cliente A', t0 + interval '9 days 10 hours', t0 + interval '9 days 11 hours') returning id into ba1;
  -- Evento personal cargado DESPUÉS de la cita ba1 y superpuesto con ella.
  insert into public.artist_calendar_events(artist_user_id, event_type, title, starts_at, ends_at, status, recurrence_rule)
  values (ax, 'personal', 'QA ROLLBACK posterior', t0 + interval '9 days 10 hours 30 minutes', t0 + interval '9 days 11 hours 30 minutes', 'scheduled', 'none');

  -- Inventario. A Q se le entrega como backend y después se pausa su vínculo.
  insert into public.studio_inventory_items(studio_id, name, unit, quantity_on_hand, cost_per_unit, currency)
  values (sid_a, 'QA ROLLBACK tinta negra', 'ml', 10, 5, 'ARS') returning id into i1;
  insert into public.studio_inventory_items(studio_id, name, unit, quantity_on_hand, cost_per_unit, currency)
  values (sid_a, 'QA ROLLBACK guantes', 'caja', 10, 2, 'ARS') returning id into i2;
  insert into public.studio_inventory_items(studio_id, name, quantity_on_hand, cost_per_unit)
  values (sid_b, 'QA ROLLBACK foreign item', 5, 1) returning id into ib;
  insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity, related_artist_user_id)
  values (sid_a, i2, 'assignment', 2, aq);
  if (select quantity_on_hand from public.studio_inventory_items where id = i2) <> 8 then
    raise exception 'AIF-F01 la entrega como backend no descontó stock';
  end if;
  update public.studio_artist_memberships set status = 'paused' where id = mq;

  perform set_config('qa_aif.t0', t0::text, true);
  perform set_config('qa_aif.owner_a', owner_a::text, true);
  perform set_config('qa_aif.owner_b', owner_b::text, true);
  perform set_config('qa_aif.support', support_id::text, true);
  perform set_config('qa_aif.ax', ax::text, true);
  perform set_config('qa_aif.az', az::text, true);
  perform set_config('qa_aif.aw', aw::text, true);
  perform set_config('qa_aif.av', av::text, true);
  perform set_config('qa_aif.au', au::text, true);
  perform set_config('qa_aif.am', am::text, true);
  perform set_config('qa_aif.aq', aq::text, true);
  perform set_config('qa_aif.ay', ay::text, true);
  perform set_config('qa_aif.sid_a', sid_a::text, true);
  perform set_config('qa_aif.sid_b', sid_b::text, true);
  perform set_config('qa_aif.loc_a', loc_a::text, true);
  perform set_config('qa_aif.loc_b', loc_b::text, true);
  perform set_config('qa_aif.sup_a', sup_a::text, true);
  perform set_config('qa_aif.sup_b', sup_b::text, true);
  perform set_config('qa_aif.mx_a', mx_a::text, true);
  perform set_config('qa_aif.mx_b', mx_b::text, true);
  perform set_config('qa_aif.mv', mv::text, true);
  perform set_config('qa_aif.i1', i1::text, true);
  perform set_config('qa_aif.i2', i2::text, true);
  perform set_config('qa_aif.ib', ib::text, true);
  perform set_config('qa_aif.ba1', ba1::text, true);
  perform set_config('qa_aif.bb1', bb1::text, true);
  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

set local role authenticated;

-- ---------------------------------------------------------------------
-- Agenda, inventario, finanzas y storage como cada parte
-- ---------------------------------------------------------------------
do $$
declare
  t0 timestamptz := current_setting('qa_aif.t0')::timestamptz;
  owner_a uuid := current_setting('qa_aif.owner_a')::uuid;
  owner_b uuid := current_setting('qa_aif.owner_b')::uuid;
  support_id uuid := current_setting('qa_aif.support')::uuid;
  ax uuid := current_setting('qa_aif.ax')::uuid;
  az uuid := current_setting('qa_aif.az')::uuid;
  aw uuid := current_setting('qa_aif.aw')::uuid;
  av uuid := current_setting('qa_aif.av')::uuid;
  au uuid := current_setting('qa_aif.au')::uuid;
  am uuid := current_setting('qa_aif.am')::uuid;
  aq uuid := current_setting('qa_aif.aq')::uuid;
  ay uuid := current_setting('qa_aif.ay')::uuid;
  sid_a uuid := current_setting('qa_aif.sid_a')::uuid;
  sid_b uuid := current_setting('qa_aif.sid_b')::uuid;
  loc_a uuid := current_setting('qa_aif.loc_a')::uuid;
  loc_b uuid := current_setting('qa_aif.loc_b')::uuid;
  sup_a uuid := current_setting('qa_aif.sup_a')::uuid;
  sup_b uuid := current_setting('qa_aif.sup_b')::uuid;
  mx_a uuid := current_setting('qa_aif.mx_a')::uuid;
  mx_b uuid := current_setting('qa_aif.mx_b')::uuid;
  mv uuid := current_setting('qa_aif.mv')::uuid;
  i1 uuid := current_setting('qa_aif.i1')::uuid;
  i2 uuid := current_setting('qa_aif.i2')::uuid;
  ib uuid := current_setting('qa_aif.ib')::uuid;
  ba1 uuid := current_setting('qa_aif.ba1')::uuid;
  bb1 uuid := current_setting('qa_aif.bb1')::uuid;
  r jsonb; st text; msg text; n integer; n2 integer; v_text text; v_uuid uuid; v_num numeric; v_num2 numeric; v_ts timestamptz;
  b4 uuid; pxn uuid; bk public.studio_bookings; mv_assign uuid; mv_return uuid; f_rent uuid; f_rent2 uuid; v_row record;
begin
  -- ===== Agenda: disponibilidad como dueño A =====
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '14 days 11 hours', t0 + interval '14 days 11 hours 30 minutes');
  if (r->>'available')::boolean or r->>'reason' is distinct from 'agenda_personal' then
    raise exception 'AIF-A01 la 3.ª ocurrencia semanal no bloqueó: %', r;
  end if;
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '28 days 10 hours', t0 + interval '28 days 11 hours');
  if not (r->>'available')::boolean or r->>'reason' is not null then
    raise exception 'AIF-A02 la recurrencia no respetó recurrence_until + 1 día: %', r;
  end if;
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '1 day 10 hours 30 minutes', t0 + interval '1 day 11 hours');
  if not (r->>'available')::boolean then raise exception 'AIF-A03 un evento availability bloqueó: %', r; end if;
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '2 days 10 hours 30 minutes', t0 + interval '2 days 11 hours');
  if not (r->>'available')::boolean then raise exception 'AIF-A04 un evento cancelado bloqueó: %', r; end if;
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '3 days 14 hours 30 minutes', t0 + interval '3 days 15 hours 30 minutes');
  if r->>'reason' is distinct from 'agenda_personal' then raise exception 'AIF-A05 la sesión de cotización no bloqueó: %', r; end if;
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '3 days 15 hours', t0 + interval '3 days 16 hours');
  if not (r->>'available')::boolean then raise exception 'AIF-A06 la sesión de 1 h no es semiabierta [inicio, fin): %', r; end if;
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '4 days 14 hours 30 minutes', t0 + interval '4 days 15 hours');
  if not (r->>'available')::boolean then raise exception 'AIF-A07 una sesión cancelada bloqueó: %', r; end if;
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '5 days 15 hours 30 minutes', t0 + interval '5 days 17 hours');
  if r->>'reason' is distinct from 'otro_estudio' then raise exception 'AIF-A08 la cita en otro estudio no bloqueó: %', r; end if;
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '6 days 15 hours 30 minutes', t0 + interval '6 days 16 hours');
  if not (r->>'available')::boolean then raise exception 'AIF-A09 una cita cancelada de otro estudio bloqueó: %', r; end if;
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '9 days 10 hours 30 minutes', t0 + interval '9 days 11 hours');
  if r->>'reason' is distinct from 'mismo_estudio' then raise exception 'AIF-A10 no detectó la cita del mismo estudio: %', r; end if;
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '9 days 10 hours 30 minutes', t0 + interval '9 days 11 hours', ba1);
  if r->>'reason' is distinct from 'agenda_personal' then raise exception 'AIF-A10b excluyendo la cita no vio la agenda personal: %', r; end if;

  st := null; begin perform public.check_studio_booking_availability(sid_a, ax, t0, t0 + interval '1 hour', bb1); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-A11 excluir una cita de otro estudio: esperaba 22023, obtuvo % (%)', st, msg; end if;
  st := null; begin perform public.check_studio_booking_availability(sid_a, ay, t0, t0 + interval '1 hour'); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-A12 artista de otro estudio: esperaba 42501, obtuvo % (%)', st, msg; end if;
  st := null; begin perform public.check_studio_booking_availability(sid_b, ax, t0, t0 + interval '1 hour'); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-A13 estudio ajeno: esperaba 42501, obtuvo % (%)', st, msg; end if;
  st := null; begin perform public.check_studio_booking_availability(sid_a, ax, t0 + interval '1 hour', t0 + interval '1 hour'); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-A14 rango vacío: esperaba 22023, obtuvo % (%)', st, msg; end if;
  st := null; begin perform private.artist_busy_conflict(sid_a, ay, t0, t0 + interval '1 hour', null); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-A15 artist_busy_conflict con artista ajeno: esperaba 42501, obtuvo % (%)', st, msg; end if;
  st := null; begin perform private.artist_busy_conflict(sid_b, ax, t0, t0 + interval '1 hour', null); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-A16 artist_busy_conflict con estudio ajeno: esperaba 42501, obtuvo % (%)', st, msg; end if;
  if private.artist_busy_conflict(sid_a, ax, t0 + interval '5 days 15 hours 30 minutes', t0 + interval '5 days 17 hours', null) is distinct from 'otro_estudio' then
    raise exception 'AIF-A17 artist_busy_conflict no devolvió otro_estudio';
  end if;
  if private.artist_busy_conflict(sid_a, ax, t0 + interval '28 days', t0 + interval '28 days 1 hour', null) is not null then
    raise exception 'AIF-A18 artist_busy_conflict marcó ocupado un horario libre';
  end if;

  -- ===== Agenda: bloques ocupados como dueño A =====
  select count(*), count(*) filter (where b.source = 'agenda_personal'), count(*) filter (where b.source = 'otro_estudio'),
         count(*) filter (where b.artist_user_id <> ax)
    into n, n2, v_num, v_num2
  from public.list_studio_artist_busy_blocks(sid_a, t0, t0 + interval '30 days') b;
  if n <> 7 or n2 <> 6 or v_num <> 1 or v_num2 <> 0 then
    raise exception 'AIF-L01 bloques del estudio A: total %, agenda % , otro estudio %, de otros artistas %', n, n2, v_num, v_num2;
  end if;
  select count(*), min(b.starts_at) into n, v_ts
  from public.list_studio_artist_busy_blocks(sid_a, t0 + interval '13 days', t0 + interval '15 days') b;
  if n <> 1 or v_ts is distinct from t0 + interval '14 days 10 hours' then
    raise exception 'AIF-L02 la recurrencia no se recortó al rango: % filas, primera %', n, v_ts;
  end if;
  st := null; begin perform * from public.list_studio_artist_busy_blocks(sid_a, t0, t0 + interval '63 days'); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-L03 rango de 63 días: esperaba 22023, obtuvo % (%)', st, msg; end if;
  st := null; begin perform * from public.list_studio_artist_busy_blocks(sid_a, t0 + interval '1 day', t0); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-L04 rango invertido: esperaba 22023, obtuvo % (%)', st, msg; end if;
  st := null; begin perform * from public.list_studio_artist_busy_blocks(sid_b, t0, t0 + interval '1 day'); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-L05 bloques de estudio ajeno: esperaba 42501, obtuvo % (%)', st, msg; end if;

  -- ===== Agenda: escrituras de citas como dueño A =====
  st := null; begin
    insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at)
    values (sid_a, ax, 'QA ROLLBACK choque semanal', t0 + interval '14 days 10 hours', t0 + interval '14 days 11 hours');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' or msg not like '%no está disponible en ese horario (agenda personal)%' then
    raise exception 'AIF-B01 cita sobre agenda personal: % (%)', st, msg;
  end if;
  st := null; begin
    insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at)
    values (sid_a, ax, 'QA ROLLBACK choque otro estudio', t0 + interval '5 days 15 hours', t0 + interval '5 days 16 hours');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' or msg not like '%no está disponible en ese horario (tiene una cita en otro estudio)%' then
    raise exception 'AIF-B02 cita sobre otro estudio: % (%)', st, msg;
  end if;
  st := null; begin
    insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at)
    values (sid_a, ax, 'QA ROLLBACK choque cotización', t0 + interval '3 days 14 hours', t0 + interval '3 days 15 hours');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' or msg not like '%(agenda personal)%' then
    raise exception 'AIF-B03 cita sobre sesión de cotización: % (%)', st, msg;
  end if;

  insert into public.studio_bookings(studio_id, location_id, artist_user_id, client_name, client_phone, service_description,
    starts_at, ends_at, amount, deposit_amount, currency, created_by_role, created_by_user_id)
  values (sid_a, loc_a, ax, 'QA ROLLBACK cita libre', '+54 11 5555-0000', 'Línea fina en antebrazo',
    t0 + interval '8 days 10 hours', t0 + interval '8 days 11 hours', 500, 100, 'ARS', 'support', owner_b)
  returning id into b4;
  select b.created_by_role, b.created_by_user_id into v_text, v_uuid from public.studio_bookings b where b.id = b4;
  if v_text is distinct from 'studio' or v_uuid is distinct from owner_a then
    raise exception 'AIF-B04 la autoría no la fijó la base: % / %', v_text, v_uuid;
  end if;
  st := null; begin
    update public.studio_bookings set starts_at = t0 + interval '21 days 11 hours', ends_at = t0 + interval '21 days 12 hours' where id = b4;
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-B05 reprogramar sobre agenda personal: % (%)', st, msg; end if;
  update public.studio_bookings set created_by_role = 'support', created_by_user_id = owner_b where id = b4;
  select b.created_by_role, b.created_by_user_id into v_text, v_uuid from public.studio_bookings b where b.id = b4;
  if v_text is distinct from 'studio' or v_uuid is distinct from owner_a then
    raise exception 'AIF-B06 la autoría se pudo editar: % / %', v_text, v_uuid;
  end if;
  -- ba1 se superpone con un evento personal posterior: editar notas no re-chequea; re-confirmar sí.
  update public.studio_bookings set notes = 'QA ROLLBACK notas' where id = ba1;
  update public.studio_bookings set status = 'cancelled' where id = ba1;
  st := null; begin update public.studio_bookings set status = 'confirmed' where id = ba1; exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-B08 re-confirmar sobre agenda personal: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at, deposit_amount)
    values (sid_a, ax, 'QA ROLLBACK seña negativa', t0 + interval '12 days 10 hours', t0 + interval '12 days 11 hours', -1);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-B09 seña negativa: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at, service_description)
    values (sid_a, ax, 'QA ROLLBACK servicio largo', t0 + interval '12 days 10 hours', t0 + interval '12 days 11 hours', repeat('x', 501));
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-B09b servicio de 501 caracteres: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_bookings(studio_id, location_id, artist_user_id, client_name, starts_at, ends_at)
    values (sid_a, loc_b, ax, 'QA ROLLBACK sede ajena', t0 + interval '12 days 10 hours', t0 + interval '12 days 11 hours');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is null then raise exception 'AIF-B10 aceptó una sede de otro estudio'; end if;
  st := null; begin
    insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at)
    values (sid_a, ay, 'QA ROLLBACK artista ajeno', t0 + interval '12 days 10 hours', t0 + interval '12 days 11 hours');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is null then raise exception 'AIF-B11 aceptó un artista que no está en el roster'; end if;

  -- ===== no_show =====
  st := null; begin update public.studio_bookings set status = 'no_show' where id = b4; exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-B12 no_show de una cita futura: % (%)', st, msg; end if;
  st := null; begin update public.studio_bookings set status = 'no_show' where id = ba1; exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-B13 no_show de una cita cancelada: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at, status)
    values (sid_a, ax, 'QA ROLLBACK no_show directo', now() - interval '5 days', now() - interval '5 days' + interval '1 hour', 'no_show');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-B14 insertar no_show directo: % (%)', st, msg; end if;
  insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at, amount, currency)
  values (sid_a, ax, 'QA ROLLBACK no vino', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 1000, 'ARS')
  returning id into pxn;
  update public.studio_bookings set status = 'no_show' where id = pxn;
  if (select b.status from public.studio_bookings b where b.id = pxn) <> 'no_show' then raise exception 'AIF-B15 no se marcó no_show'; end if;
  st := null; begin perform public.complete_studio_booking(pxn); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-B16 completar una cita no asistida: % (%)', st, msg; end if;

  -- ===== Reparto al completar =====
  for v_row in
    select * from (values
      (ax, 1000.00::numeric, 600.00::numeric, 400.00::numeric, 'membresía 60%'),
      (az, 333.33, 233.33, 100.00, 'contrato 70% (membresía 50%)'),
      (aw, 1000.00, 1000.00, 0.00, 'fijo artist_to_studio'),
      (av, 1000.00, null, 1000.00, 'fijo studio_to_artist'),
      (au, 1000.00, null, null, 'sin datos'),
      (am, 1000.00, 550.00, 450.00, 'mixto 55%')
    ) as c(artist, gross, artist_split, studio_split, label)
  loop
    insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at, amount, currency)
    values (sid_a, v_row.artist, 'QA ROLLBACK ' || v_row.label, now() - interval '2 days', now() - interval '2 days' + interval '2 hours', v_row.gross, 'ARS')
    returning id into v_uuid;
    bk := public.complete_studio_booking(v_uuid);
    if bk.status <> 'completed' or bk.job_log_id is null then raise exception 'AIF-C00 % no se completó', v_row.label; end if;
    select j.artist_split_amount, j.studio_split_amount into v_num, v_num2 from public.studio_jobs_log j where j.id = bk.job_log_id;
    if v_num is distinct from v_row.artist_split or v_num2 is distinct from v_row.studio_split then
      raise exception 'AIF-C01 reparto %: esperaba % / %, obtuvo % / %', v_row.label, v_row.artist_split, v_row.studio_split, v_num, v_num2;
    end if;
  end loop;

  -- ===== Inventario como dueño A =====
  st := null; begin
    insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity) values (sid_a, ib, 'consumption', 1);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-I01 ítem de otro estudio: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity) values (sid_a, i1, 'assignment', 1);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-I02 entrega sin artista: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity, related_artist_user_id) values (sid_a, i1, 'assignment', 1, ay);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-I03 entrega a artista ajeno: % (%)', st, msg; end if;
  insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity, related_artist_user_id)
  values (sid_a, i1, 'assignment', 3, ax) returning id, unit_cost into mv_assign, v_num;
  if v_num is distinct from 5::numeric or (select quantity_on_hand from public.studio_inventory_items where id = i1) <> 7 then
    raise exception 'AIF-I04 la entrega no precargó costo o no descontó stock (costo %)', v_num;
  end if;
  st := null; begin
    insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity, related_artist_user_id) values (sid_a, i1, 'assignment', 8, ax);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' or msg not like 'Stock insuficiente de QA ROLLBACK tinta negra%'
     or (select quantity_on_hand from public.studio_inventory_items where id = i1) <> 7 then
    raise exception 'AIF-I05 entrega sin stock: % (%)', st, msg;
  end if;
  st := null; begin
    insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity, related_artist_user_id) values (sid_a, i1, 'return', 4, ax);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-I06 devolución mayor a lo entregado: % (%)', st, msg; end if;
  insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity, related_artist_user_id)
  values (sid_a, i1, 'return', 1, ax) returning id into mv_return;
  insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity, related_artist_user_id)
  values (sid_a, i1, 'consumption', 1, ax);
  if (select quantity_on_hand from public.studio_inventory_items where id = i1) <> 7 then
    raise exception 'AIF-I07 stock tras devolución y consumo: %', (select quantity_on_hand from public.studio_inventory_items where id = i1);
  end if;
  select b.assigned_qty, b.returned_qty, b.net_assigned_qty, b.consumed_qty, b.assigned_cost, b.item_name, b.unit, b.currency
    into v_row
  from public.studio_artist_material_balance b
  where b.studio_id = sid_a and b.artist_user_id = ax and b.item_id = i1;
  if v_row.assigned_qty is distinct from 3 or v_row.returned_qty is distinct from 1 or v_row.net_assigned_qty is distinct from 2 or v_row.consumed_qty is distinct from 1
     or v_row.assigned_cost is distinct from 10 or v_row.item_name is distinct from 'QA ROLLBACK tinta negra' or v_row.unit is distinct from 'ml' or v_row.currency is distinct from 'ARS' then
    raise exception 'AIF-I08 balance de materiales: %', row_to_json(v_row);
  end if;
  select count(*), sum(m.quantity), sum(m.cost) into n, v_num, v_num2
  from public.studio_material_assignment_monthly m where m.studio_id = sid_a and m.artist_user_id = ax;
  if n <> 1 or v_num <> 2 or v_num2 <> 10 then
    raise exception 'AIF-I09 materiales mensuales: % filas, cantidad %, costo %', n, v_num, v_num2;
  end if;
  -- Q tiene el vínculo en pausa: puede devolver lo que tiene, no recibir más.
  insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity, related_artist_user_id) values (sid_a, i2, 'return', 1, aq);
  if (select quantity_on_hand from public.studio_inventory_items where id = i2) <> 9 then raise exception 'AIF-I10 devolución de artista en pausa'; end if;
  st := null; begin
    insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity, related_artist_user_id) values (sid_a, i2, 'assignment', 1, aq);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-I11 entrega a artista en pausa: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity, related_artist_user_id) values (sid_a, i2, 'return', 2, aq);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-I12 devolución que supera el neto: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity) values (sid_a, i1, 'adjustment', -100);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-I13 ajuste negativo bajo cero: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_inventory_movements(studio_id, item_id, kind, quantity, related_artist_user_id) values (sid_a, i1, 'return', 1, ay);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-I14 devolución de un artista que nunca estuvo: % (%)', st, msg; end if;
  if (select count(*) from public.list_my_studio_material_assignments()) <> 0 then
    raise exception 'AIF-I15 el dueño ve entregas como si fuera artista';
  end if;
  perform set_config('qa_aif.mv_assign', mv_assign::text, true);
  perform set_config('qa_aif.mv_return', mv_return::text, true);

  -- ===== Finanzas como dueño A =====
  insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, created_by_user_id)
  values (sid_a, 'expense', 'rent', 'QA ROLLBACK alquiler', 1000, 'ARS', owner_b)
  returning id, created_by_user_id into f_rent, v_uuid;
  if v_uuid is distinct from owner_a then raise exception 'AIF-F02 created_by_user_id no se forzó: %', v_uuid; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency) values (sid_a, 'expense', 'chair_rent', 'QA', 1, 'ARS');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-F03 gasto con categoría de ingreso: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency) values (sid_a, 'income', 'rent', 'QA', 1, 'ARS');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-F04 ingreso con categoría de gasto: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, supply_order_id)
    values (sid_a, 'expense', 'inventory_purchase', 'QA', 1, 'ARS', gen_random_uuid());
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-F05 supply_order_id desde el cliente: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, location_id) values (sid_a, 'expense', 'rent', 'QA', 1, 'ARS', loc_b);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-F06 sede ajena: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, supplier_id) values (sid_a, 'expense', 'supplies', 'QA', 1, 'ARS', sup_b);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-F07 proveedor ajeno: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, membership_id) values (sid_a, 'expense', 'other', 'QA', 1, 'ARS', mx_b);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-F08 membresía ajena: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, membership_id, artist_user_id)
    values (sid_a, 'expense', 'other', 'QA', 1, 'ARS', mx_a, az);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-F09 artista que no coincide con la membresía: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, artist_user_id)
    values (sid_a, 'expense', 'other', 'QA', 1, 'ARS', ay);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-F10 artista ajeno sin membresía: % (%)', st, msg; end if;
  insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, membership_id, location_id, supplier_id)
  values (sid_a, 'expense', 'other', 'QA ROLLBACK varios', 10, 'ARS', mx_a, loc_a, sup_a)
  returning artist_user_id into v_uuid;
  if v_uuid is distinct from ax then raise exception 'AIF-F11 artist_user_id no se completó desde la membresía: %', v_uuid; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, receipt_storage_path)
    values (sid_a, 'expense', 'supplies', 'QA', 1, 'ARS', sid_b::text || '/finance/r.pdf');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-F12 comprobante de otro estudio: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, receipt_storage_path)
    values (sid_a, 'expense', 'supplies', 'QA', 1, 'ARS', sid_a::text || '/finance/../' || sid_b::text || '/r.pdf');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-F13 comprobante con "..": % (%)', st, msg; end if;
  insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, receipt_storage_path, payment_method, counterparty)
  values (sid_a, 'expense', 'supplies', 'QA ROLLBACK insumos', 50, 'ARS', sid_a::text || '/finance/2026/r.pdf', 'transfer', 'QA ROLLBACK proveedor');
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency) values (sid_b, 'expense', 'rent', 'QA', 1, 'ARS');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-F14 alta en estudio ajeno: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency) values (sid_a, 'expense', 'rent', 'QA', 0, 'ARS');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-F15 importe 0: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency) values (sid_a, 'expense', 'rent', 'QA', 1, 'ars');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-F16 moneda inválida: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency) values (sid_a, 'expense', 'rent', '   ', 1, 'ARS');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-F17 descripción vacía: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, payment_method) values (sid_a, 'expense', 'rent', 'QA', 1, 'ARS', 'crypto');
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-F18 medio de pago inválido: % (%)', st, msg; end if;
  st := null; begin
    insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, status, void_reason, voided_at)
    values (sid_a, 'expense', 'rent', 'QA', 1, 'ARS', 'voided', 'QA', now());
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-F19 alta ya anulada: % (%)', st, msg; end if;

  update public.studio_finance_entries set amount = 1200 where id = f_rent;
  st := null; begin update public.studio_finance_entries set status = 'voided' where id = f_rent; exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '22023' then raise exception 'AIF-F20 anular sin motivo: % (%)', st, msg; end if;
  st := null; begin update public.studio_finance_entries set status = 'voided', void_reason = 'Duplicado', amount = 1 where id = f_rent; exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-F21 anular y editar a la vez: % (%)', st, msg; end if;
  update public.studio_finance_entries set status = 'voided', void_reason = '  Duplicado  ' where id = f_rent;
  select f.status, f.void_reason, f.amount, (f.voided_at is not null) as has_voided_at into v_row
  from public.studio_finance_entries f where f.id = f_rent;
  if v_row.status is distinct from 'voided' or v_row.void_reason is distinct from 'Duplicado' or v_row.amount is distinct from 1200 or v_row.has_voided_at is not true then
    raise exception 'AIF-F22 anulación: %', row_to_json(v_row);
  end if;
  st := null; begin update public.studio_finance_entries set description = 'QA editado' where id = f_rent; exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-F23 editar una fila anulada: % (%)', st, msg; end if;
  st := null; begin update public.studio_finance_entries set status = 'recorded' where id = f_rent; exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '23514' then raise exception 'AIF-F24 des-anular: % (%)', st, msg; end if;
  st := null; begin delete from public.studio_finance_entries where id = f_rent; exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-F25 DELETE permitido: % (%)', st, msg; end if;

  insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency)
  values (sid_a, 'expense', 'rent', 'QA ROLLBACK alquiler bien cargado', 800, 'ARS') returning id into f_rent2;
  insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency)
  values (sid_a, 'income', 'chair_rent', 'QA ROLLBACK alquiler de puesto', 500, 'ARS');
  insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency, membership_id)
  values (sid_a, 'expense', 'artist_payout', 'QA ROLLBACK pago fijo a V', 300, 'ARS', mv);
  st := null; begin update public.studio_finance_entries set studio_id = sid_b where id = f_rent2; exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-F26 mover a otro estudio: % (%)', st, msg; end if;
  st := null; begin update public.studio_finance_entries set supply_order_id = gen_random_uuid() where id = f_rent2; exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-F27 asignar supply_order_id: % (%)', st, msg; end if;

  for v_row in
    select * from (values
      ('expense', 'rent', 800.00::numeric, 1),
      ('expense', 'supplies', 50.00, 1),
      ('expense', 'other', 10.00, 1),
      ('expense', 'artist_payout', 300.00, 1),
      ('income', 'chair_rent', 500.00, 1)
    ) as e(entry_type, category, total, entries)
  loop
    select v.total, v.entries into v_num, n
    from public.studio_finance_monthly_by_category v
    where v.studio_id = sid_a and v.month = date_trunc('month', current_date::timestamp)::date and v.currency = 'ARS'
      and v.entry_type = v_row.entry_type and v.category = v_row.category;
    if v_num is distinct from v_row.total or n is distinct from v_row.entries then
      raise exception 'AIF-F28 resumen % / %: esperaba % (%), obtuvo % (%)', v_row.entry_type, v_row.category, v_row.total, v_row.entries, v_num, n;
    end if;
  end loop;
  if (select count(*) from public.studio_finance_monthly_by_category v where v.studio_id = sid_a) <> 5 then
    raise exception 'AIF-F29 el resumen mensual incluye filas anuladas';
  end if;
  if has_table_privilege('anon', 'public.studio_finance_entries', 'SELECT')
     or has_table_privilege('anon', 'public.studio_finance_monthly_by_category', 'SELECT')
     or has_table_privilege('anon', 'public.studio_artist_material_balance', 'SELECT')
     or has_table_privilege('anon', 'public.studio_material_assignment_monthly', 'SELECT')
     or has_table_privilege('authenticated', 'public.studio_finance_entries', 'DELETE') then
    raise exception 'AIF-F30 privilegios de tabla o vistas demasiado amplios';
  end if;

  -- ===== Storage como dueño A =====
  if not private.can_manage_studio_storage_path(sid_a::text || '/finance/r.pdf')
     or private.can_manage_studio_storage_path(sid_b::text || '/finance/r.pdf')
     or private.can_manage_studio_storage_path('sin-carpeta.pdf')
     or private.can_manage_studio_storage_path('otra-cosa/' || sid_a::text || '/r.pdf') then
    raise exception 'AIF-S01 can_manage_studio_storage_path para el dueño';
  end if;
  insert into storage.objects(bucket_id, name, owner_id) values ('studio-documents', sid_a::text || '/finance/qa-aif.pdf', owner_a::text);
  if (select count(*) from storage.objects o where o.bucket_id = 'studio-documents' and o.name = sid_a::text || '/finance/qa-aif.pdf') <> 1 then
    raise exception 'AIF-S02 el dueño no puede leer su comprobante';
  end if;
  insert into storage.objects(bucket_id, name, owner_id) values ('studio-photos', sid_a::text || '/gallery/qa-aif.png', owner_a::text);
  insert into storage.objects(bucket_id, name, owner_id) values ('studio-spot-attachments', sid_a::text || '/spots/qa-aif.png', owner_a::text);
  st := null; begin
    insert into storage.objects(bucket_id, name, owner_id) values ('studio-documents', sid_b::text || '/finance/qa-aif.pdf', owner_a::text);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-S03 subida a carpeta de otro estudio (documents): % (%)', st, msg; end if;
  st := null; begin
    insert into storage.objects(bucket_id, name, owner_id) values ('studio-spot-attachments', sid_b::text || '/qa-aif.png', owner_a::text);
  exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-S04 subida a carpeta de otro estudio (spots): % (%)', st, msg; end if;

  -- ===== Artista X =====
  perform set_config('request.jwt.claim.sub', ax::text, true);
  select count(distinct b.studio_id), count(*) filter (where b.artist_user_id <> ax) into n, n2 from public.studio_bookings b;
  if n <> 2 or n2 <> 0 then raise exception 'AIF-R01 el artista ve % estudios y % citas ajenas', n, n2; end if;
  update public.studio_bookings set notes = 'QA ROLLBACK hack' where id = b4;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'AIF-R02 el artista pudo editar una cita'; end if;
  st := null; begin perform public.check_studio_booking_availability(sid_a, ax, t0, t0 + interval '1 hour'); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-R03 el artista consultó la agenda del estudio: % (%)', st, msg; end if;
  st := null; begin perform * from public.list_studio_artist_busy_blocks(sid_a, t0, t0 + interval '1 day'); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-R04 el artista listó bloques del estudio: % (%)', st, msg; end if;
  st := null; begin perform private.artist_busy_conflict(sid_a, ax, t0, t0 + interval '1 hour', null); exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is distinct from '42501' then raise exception 'AIF-R05 el artista llamó artist_busy_conflict: % (%)', st, msg; end if;
  select count(*), count(*) filter (where m.kind not in ('assignment', 'return')),
         count(*) filter (where m.studio_name <> 'QA ROLLBACK studio A'),
         sum(case m.kind when 'assignment' then m.quantity else -m.quantity end)
    into n, n2, v_num, v_num2
  from public.list_my_studio_material_assignments() m;
  if n <> 2 or n2 <> 0 or v_num <> 0 or v_num2 <> 2 then
    raise exception 'AIF-R06 materiales del artista: % filas, % de otro tipo, % de otro estudio, neto %', n, n2, v_num, v_num2;
  end if;
  if (select count(*) from public.studio_artist_material_balance) <> 0
     or (select count(*) from public.studio_finance_entries) <> 0
     or private.can_manage_studio_storage_path(sid_a::text || '/finance/r.pdf')
     or (select count(*) from storage.objects o where o.bucket_id = 'studio-documents' and o.name like sid_a::text || '/%') <> 0 then
    raise exception 'AIF-R07 el artista ve balance, finanzas o documentos del estudio';
  end if;
  perform set_config('request.jwt.claim.sub', aq::text, true);
  if (select count(*) from public.list_my_studio_material_assignments()) <> 2 then
    raise exception 'AIF-R08 el artista en pausa no ve sus entregas y devoluciones';
  end if;

  -- ===== Dueño B =====
  perform set_config('request.jwt.claim.sub', owner_b::text, true);
  if (select count(*) from public.studio_bookings b where b.studio_id = sid_a) <> 0 then raise exception 'AIF-O01 el dueño B ve citas de A'; end if;
  r := public.check_studio_booking_availability(sid_b, ax, t0 + interval '8 days 10 hours', t0 + interval '8 days 11 hours');
  if r->>'reason' is distinct from 'otro_estudio' then raise exception 'AIF-O02 B no vio la cita de X en A: %', r; end if;
  select count(*), count(*) filter (where b.source = 'otro_estudio'), count(*) filter (where b.artist_user_id = ay)
    into n, n2, v_num
  from public.list_studio_artist_busy_blocks(sid_b, t0, t0 + interval '30 days') b;
  if n <> 7 or n2 <> 1 or v_num <> 0 then raise exception 'AIF-O03 bloques del estudio B: total %, otro estudio %, de Y %', n, n2, v_num; end if;
  if (select count(*) from public.studio_finance_entries f where f.studio_id = sid_a) <> 0
     or (select count(*) from public.studio_finance_monthly_by_category v where v.studio_id = sid_a) <> 0
     or (select count(*) from public.studio_artist_material_balance b where b.studio_id = sid_a) <> 0
     or (select count(*) from public.studio_material_assignment_monthly m where m.studio_id = sid_a) <> 0 then
    raise exception 'AIF-O04 el dueño B ve finanzas o materiales de A';
  end if;
  st := null; begin update public.studio_finance_entries set amount = 1 where id = f_rent2; exception when others then st := sqlstate; msg := sqlerrm; end;
  if (select count(*) from public.studio_finance_entries f where f.id = f_rent2) <> 0 then raise exception 'AIF-O05 el dueño B lee filas de A'; end if;

  -- ===== Soporte =====
  perform set_config('request.jwt.claim.sub', support_id::text, true);
  if (select count(*) from public.studio_bookings b where b.studio_id = sid_a) = 0 then raise exception 'AIF-S10 soporte no ve las citas'; end if;
  insert into public.studio_bookings(studio_id, artist_user_id, client_name, starts_at, ends_at, created_by_role)
  values (sid_a, ax, 'QA ROLLBACK cita de soporte', t0 + interval '10 days 10 hours', t0 + interval '10 days 11 hours', 'studio')
  returning id into v_uuid;
  select b.created_by_role, b.created_by_user_id into v_text, v_uuid from public.studio_bookings b where b.id = v_uuid;
  if v_text is distinct from 'support' or v_uuid is distinct from support_id then raise exception 'AIF-S11 autoría de soporte: % / %', v_text, v_uuid; end if;
  select count(*) into n from public.list_studio_artist_busy_blocks(sid_a, t0, t0 + interval '30 days');
  if n <> 7 then raise exception 'AIF-S12 soporte ve % bloques (esperaba 7)', n; end if;
  r := public.check_studio_booking_availability(sid_a, ax, t0 + interval '10 days 10 hours 30 minutes', t0 + interval '10 days 11 hours');
  if r->>'reason' is distinct from 'mismo_estudio' then raise exception 'AIF-S13 soporte no vio la cita del mismo estudio: %', r; end if;
  if (select count(*) from public.studio_finance_entries f where f.studio_id = sid_a) < 5 then raise exception 'AIF-S14 soporte no ve el libro'; end if;
  insert into public.studio_finance_entries(studio_id, entry_type, category, description, amount, currency)
  values (sid_a, 'expense', 'fees', 'QA ROLLBACK comisión cargada por soporte', 20, 'ARS');
  if not private.can_manage_studio_storage_path(sid_b::text || '/finance/r.pdf') then raise exception 'AIF-S15 soporte no gestiona storage de estudios'; end if;
end $$;

reset role;

-- ---------------------------------------------------------------------
-- Rama DELETE de apply_inventory_movement, grants y policies (postgres)
-- ---------------------------------------------------------------------
do $$
declare
  i1 uuid := current_setting('qa_aif.i1')::uuid;
  v_before numeric;
  v_after numeric;
  n integer;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  select quantity_on_hand into v_before from public.studio_inventory_items where id = i1;
  delete from public.studio_inventory_movements where id = current_setting('qa_aif.mv_return')::uuid;
  select quantity_on_hand into v_after from public.studio_inventory_items where id = i1;
  if v_after <> v_before - 1 then raise exception 'AIF-D01 borrar una devolución no restó stock (% → %)', v_before, v_after; end if;
  delete from public.studio_inventory_movements where id = current_setting('qa_aif.mv_assign')::uuid;
  select quantity_on_hand into v_before from public.studio_inventory_items where id = i1;
  if v_before <> v_after + 3 then raise exception 'AIF-D02 borrar una entrega no devolvió stock (% → %)', v_after, v_before; end if;

  if has_function_privilege('authenticated', 'private.artist_busy_intervals(uuid, uuid, timestamptz, timestamptz, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'private.artist_busy_conflict(uuid, uuid, timestamptz, timestamptz, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.artist_busy_conflict(uuid, uuid, timestamptz, timestamptz, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.check_studio_booking_availability(uuid, uuid, timestamptz, timestamptz, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_studio_artist_busy_blocks(uuid, timestamptz, timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_my_studio_material_assignments()', 'EXECUTE')
     or has_function_privilege('anon', 'private.can_manage_studio_storage_path(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.check_studio_booking_availability(uuid, uuid, timestamptz, timestamptz, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.list_studio_artist_busy_blocks(uuid, timestamptz, timestamptz)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.list_my_studio_material_assignments()', 'EXECUTE') then
    raise exception 'AIF-D03 grants de funciones de agenda o storage';
  end if;

  select count(*) into n from pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects'
    and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%can_manage_studio_storage_path%';
  if n <> 10 then raise exception 'AIF-D04 policies de storage con el helper: % (esperaba 10)', n; end if;
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname like 'studio\_%'
      and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%foldername(s.name)%'
  ) then
    raise exception 'AIF-D05 quedó una policy de storage que compara el nombre del estudio';
  end if;
  if (select count(*) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname in ('studio_photos_authenticated_read', 'studio_spot_atts_authenticated_read')) <> 2 then
    raise exception 'AIF-D06 se perdió una lectura existente de storage';
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $$;
select 'PASS: agenda (ocupado personal/cotización/otro estudio, recurrencia, RPCs y rechazos), citas (autoría, no_show, reprogramación, reparto), materiales por artista, libro de finanzas y storage de estudios' as result;
rollback;
