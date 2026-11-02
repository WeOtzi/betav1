-- Run after 20261030200000_studio_affiliations (M1) and
-- 20261030201000_studio_contracts (M2) as postgres. Existing identities are
-- only read; every fixture ("QA ROLLBACK") and state change is rolled back.
-- Covers: membership guard, artist requests (decide/withdraw/72 h), public
-- roster, artists_db pointer guard, studios guard, studio claims, the
-- registration patch, spot application → draft → issue → sign, new
-- versions, termination, invitation/request contracts, counter-offers,
-- withdrawal, cancellation, expiry and the contract inbox.
begin;
-- Fixtures as postgres even if a previous chained test left a role set.
reset role;
do $$
declare
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_x uuid := gen_random_uuid();
  v_y uuid := gen_random_uuid();
  v_z uuid := gen_random_uuid();
  v_support uuid := gen_random_uuid();
  v_claimant uuid := gen_random_uuid();
  v_unconfirmed uuid := gen_random_uuid();
  v_studio_a uuid; v_studio_b uuid; v_catalog uuid; v_catalog2 uuid;
  v_loc_a uuid; v_loc_b uuid; v_spot_a uuid; v_spot_a2 uuid; v_spot_b uuid; v_ended_xb uuid;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_owner_a, 'authenticated', 'authenticated', 'qa-aff-owner-a-' || v_owner_a || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now()),
    (v_owner_b, 'authenticated', 'authenticated', 'qa-aff-owner-b-' || v_owner_b || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now()),
    (v_x, 'authenticated', 'authenticated', 'qa-aff-artist-x-' || v_x || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"artist","name":"QA ROLLBACK artista X"}'::jsonb, now(), now()),
    (v_y, 'authenticated', 'authenticated', 'qa-aff-artist-y-' || v_y || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"artist","name":"QA ROLLBACK artista Y"}'::jsonb, now(), now()),
    (v_z, 'authenticated', 'authenticated', 'qa-aff-artist-z-' || v_z || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"artist","name":"QA ROLLBACK artista Z"}'::jsonb, now(), now()),
    (v_support, 'authenticated', 'authenticated', 'qa-aff-support-' || v_support || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now()),
    (v_claimant, 'authenticated', 'authenticated', 'qa-aff-claimant-' || v_claimant || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now()),
    (v_unconfirmed, 'authenticated', 'authenticated', 'qa-aff-unconfirmed-' || v_unconfirmed || '@example.invalid', null, '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now());

  insert into public.artists_db (user_id, name, username)
  values
    (v_x, 'QA ROLLBACK artista X', 'qa-aff-x-' || v_tag),
    (v_y, 'QA ROLLBACK artista Y', 'qa-aff-y-' || v_tag),
    (v_z, 'QA ROLLBACK artista Z', 'qa-aff-z-' || v_tag)
  on conflict (user_id) do update set name = excluded.name, username = excluded.username;

  insert into public.support_users_db (user_id, email, full_name, role, is_active)
  values (v_support, 'qa-aff-support-' || v_support || '@example.invalid', 'QA ROLLBACK soporte', 'support', true);

  insert into public.studios (user_id, name, normalized_name, slug, is_active)
  values (v_owner_a, 'QA ROLLBACK Estudio A ' || v_tag, 'QA ROLLBACK ESTUDIO A ' || upper(v_tag), 'qa-rollback-a-' || v_tag, true)
  returning id into v_studio_a;
  insert into public.studios (user_id, name, normalized_name, slug, is_active)
  values (v_owner_b, 'QA ROLLBACK Estudio B ' || v_tag, 'QA ROLLBACK ESTUDIO B ' || upper(v_tag), 'qa-rollback-b-' || v_tag, true)
  returning id into v_studio_b;
  insert into public.studios (name, normalized_name, slug, is_active)
  values ('QA ROLLBACK Catalogo Uno ' || v_tag, upper('QA ROLLBACK Catalogo Uno ' || v_tag), 'qa-rollback-cat1-' || v_tag, true)
  returning id into v_catalog;
  insert into public.studios (name, normalized_name, slug, is_active)
  values ('QA ROLLBACK Catalogo Dos ' || v_tag, upper('QA ROLLBACK Catalogo Dos ' || v_tag), 'qa-rollback-cat2-' || v_tag, true)
  returning id into v_catalog2;

  insert into public.studio_locations (studio_id, label, formatted_address, city, country, is_primary)
  values (v_studio_a, 'QA ROLLBACK sede A', 'Calle QA 123', 'Buenos Aires', 'Argentina', true)
  returning id into v_loc_a;
  insert into public.studio_locations (studio_id, label, formatted_address, city, country, is_primary)
  values (v_studio_b, 'QA ROLLBACK sede B', 'Calle QA 456', 'Rosario', 'Argentina', true)
  returning id into v_loc_b;

  insert into public.studio_spots (
    studio_id, location_id, title, kind, status, revenue_split_pct, start_date, end_date,
    includes_housing, studio_includes, artist_expectations, benefit_tags
  ) values (
    v_studio_a, v_loc_a, 'QA ROLLBACK guest spot', 'guest_spot', 'open', 60, current_date + 10, current_date + 40,
    true, array['Estación propia'], array['Cuatro días por semana'], array['Agenda garantizada']
  ) returning id into v_spot_a;
  insert into public.studio_spots (
    studio_id, location_id, title, kind, status, revenue_split_pct,
    stipend_amount, stipend_currency, stipend_frequency, start_date
  ) values (
    v_studio_a, v_loc_a, 'QA ROLLBACK residencia con stipend', 'resident', 'open', 50,
    1000, 'usd ', 'weekly', current_date + 5
  ) returning id into v_spot_a2;
  insert into public.studio_spots (studio_id, location_id, title, kind, status)
  values (v_studio_b, v_loc_b, 'QA ROLLBACK spot B', 'resident', 'open')
  returning id into v_spot_b;

  -- Vínculo histórico de X con el estudio B (cerrado: no bloquea solicitudes).
  insert into public.studio_artist_memberships (studio_id, artist_user_id, role, status, started_at, ended_at)
  values (v_studio_b, v_x, 'guest', 'ended', now() - interval '60 days', now() - interval '30 days')
  returning id into v_ended_xb;

  perform set_config('qa_aff.owner_a', v_owner_a::text, true);
  perform set_config('qa_aff.owner_b', v_owner_b::text, true);
  perform set_config('qa_aff.artist_x', v_x::text, true);
  perform set_config('qa_aff.artist_y', v_y::text, true);
  perform set_config('qa_aff.artist_z', v_z::text, true);
  perform set_config('qa_aff.support', v_support::text, true);
  perform set_config('qa_aff.claimant', v_claimant::text, true);
  perform set_config('qa_aff.unconfirmed', v_unconfirmed::text, true);
  perform set_config('qa_aff.studio_a', v_studio_a::text, true);
  perform set_config('qa_aff.studio_b', v_studio_b::text, true);
  perform set_config('qa_aff.catalog', v_catalog::text, true);
  perform set_config('qa_aff.catalog2', v_catalog2::text, true);
  perform set_config('qa_aff.catalog2_name', 'QA ROLLBACK Catalogo Dos ' || v_tag, true);
  perform set_config('qa_aff.loc_a', v_loc_a::text, true);
  perform set_config('qa_aff.loc_b', v_loc_b::text, true);
  perform set_config('qa_aff.spot_a', v_spot_a::text, true);
  perform set_config('qa_aff.spot_a2', v_spot_a2::text, true);
  perform set_config('qa_aff.spot_b', v_spot_b::text, true);
  perform set_config('qa_aff.ended_xb', v_ended_xb::text, true);
  perform set_config('qa_aff.slug_a', 'qa-rollback-a-' || v_tag, true);
  perform set_config('qa_aff.claimant_email', 'qa-aff-claimant-' || v_claimant || '@example.invalid', true);
  perform set_config('qa_aff.artist_y_email', 'qa-aff-artist-y-' || v_y || '@example.invalid', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
end $$;

-- ---------------------------------------------------------------------
-- M1 · guard de membresías, solicitudes y puntero del artista
-- ---------------------------------------------------------------------
set local role authenticated;
do $$
declare
  v_owner_a uuid := current_setting('qa_aff.owner_a')::uuid;
  v_owner_b uuid := current_setting('qa_aff.owner_b')::uuid;
  v_x uuid := current_setting('qa_aff.artist_x')::uuid;
  v_y uuid := current_setting('qa_aff.artist_y')::uuid;
  v_studio_a uuid := current_setting('qa_aff.studio_a')::uuid;
  v_studio_b uuid := current_setting('qa_aff.studio_b')::uuid;
  v_catalog uuid := current_setting('qa_aff.catalog')::uuid;
  v_loc_a uuid := current_setting('qa_aff.loc_a')::uuid;
  v_loc_b uuid := current_setting('qa_aff.loc_b')::uuid;
  v_res jsonb; v_mid uuid; v_mid_u uuid; v_mid_y uuid; v_inv_y uuid; v_req_yb uuid;
  denied boolean;
begin
  -- El estudio solo crea invitaciones pendientes.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  denied := false;
  begin
    insert into public.studio_artist_memberships (studio_id, artist_user_id, role, status)
    values (v_studio_a, v_x, 'resident', 'active');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: el estudio creó un vínculo activo directo'; end if;
  denied := false;
  begin
    insert into public.studio_artist_memberships (studio_id, artist_user_id, role, status, started_at)
    values (v_studio_a, v_x, 'resident', 'pending_acceptance', now());
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: invitación con started_at aceptada'; end if;

  insert into public.studio_artist_memberships (studio_id, artist_user_id, role, status, invited_at)
  values (v_studio_a, v_y, 'guest', 'pending_acceptance', now())
  returning id into v_inv_y;
  denied := false;
  begin update public.studio_artist_memberships set status = 'active' where id = v_inv_y;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: invitación activada sin respuesta del artista'; end if;
  denied := false;
  begin update public.studio_artist_memberships set initiated_by = 'artist' where id = v_inv_y;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: initiated_by editable desde el cliente'; end if;
  denied := false;
  begin update public.studio_artist_memberships set artist_user_id = v_x where id = v_inv_y;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: el artista de la membresía es editable'; end if;
  update public.studio_artist_memberships set status = 'ended', ended_at = now() where id = v_inv_y;
  denied := false;
  begin update public.studio_artist_memberships set status = 'pending_acceptance' where id = v_inv_y;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: una invitación cancelada se reabrió'; end if;

  -- Solicitud de alta: validaciones.
  denied := false;
  begin perform public.request_studio_membership(v_studio_a);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: un usuario sin perfil de artista pidió el alta'; end if;

  perform set_config('request.jwt.claim.sub', v_x::text, true);
  denied := false;
  begin perform public.request_studio_membership(v_studio_a, 'manager');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: rol manager aceptado en una solicitud'; end if;
  denied := false;
  begin perform public.request_studio_membership(v_studio_a, 'resident', v_loc_b);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: solicitud con sede de otro estudio aceptada'; end if;
  denied := false;
  begin perform public.request_studio_membership(v_studio_a, 'resident', null, null, 'javascript:alert(1)');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: portfolio sin http(s) aceptado'; end if;

  v_res := public.request_studio_membership(v_studio_a, 'resident', v_loc_a, 'Quiero sumarme al estudio',
    'https://example.com/qa-portfolio', current_date + 7);
  v_mid := (v_res ->> 'membership_id')::uuid;
  if v_mid is null or (v_res ->> 'studio_has_owner')::boolean is distinct from true then
    raise exception 'QA: respuesta de solicitud inválida: %', v_res;
  end if;
  if (select m.status || '/' || m.initiated_by from public.studio_artist_memberships m where m.id = v_mid)
     is distinct from 'requested/artist' then
    raise exception 'QA: la solicitud no quedó requested/artist';
  end if;
  if not exists (
    select 1 from public.studio_membership_request_details d
    where d.membership_id = v_mid and d.portfolio_url = 'https://example.com/qa-portfolio'
      and d.proposed_start_date = current_date + 7
  ) then
    raise exception 'QA: el artista no ve el detalle de su solicitud';
  end if;
  denied := false;
  begin perform public.request_studio_membership(v_studio_a, 'guest');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: segunda solicitud abierta con el mismo estudio'; end if;

  v_res := public.request_studio_membership(v_catalog, 'resident');
  v_mid_u := (v_res ->> 'membership_id')::uuid;
  if (v_res ->> 'studio_has_owner')::boolean is distinct from false then
    raise exception 'QA: un estudio sin dueño figura con dueño';
  end if;

  -- Cross-tenant: otro estudio no decide ni ve la solicitud.
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  denied := false;
  begin perform public.decide_studio_membership_request(v_mid, 'accept');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: otro estudio decidió la solicitud'; end if;
  if exists (select 1 from public.studio_membership_request_details d where d.membership_id = v_mid) then
    raise exception 'QA: otro estudio ve el detalle de la solicitud';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  if not exists (select 1 from public.studio_membership_request_details d where d.membership_id = v_mid) then
    raise exception 'QA: el dueño no ve el detalle de la solicitud';
  end if;
  denied := false;
  begin update public.studio_artist_memberships set status = 'active' where id = v_mid;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: solicitud activada sin RPC'; end if;
  denied := false;
  begin perform public.decide_studio_membership_request(v_mid, 'maybe');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: decisión inválida aceptada'; end if;
  denied := false;
  begin perform public.decide_studio_membership_request(v_mid, 'accept', null, v_loc_b);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: aprobación con sede de otro estudio'; end if;

  v_res := public.decide_studio_membership_request(v_mid, 'accept', null, v_loc_a);
  if v_res ->> 'status' is distinct from 'active' or (v_res ->> 'artist_user_id')::uuid is distinct from v_x
     or (v_res ->> 'studio_id')::uuid is distinct from v_studio_a then
    raise exception 'QA: aprobación inválida: %', v_res;
  end if;
  if not exists (
    select 1 from public.studio_artist_memberships m
    where m.id = v_mid and m.status = 'active' and m.started_at is not null and m.location_id = v_loc_a
  ) then
    raise exception 'QA: la aprobación no activó el vínculo';
  end if;
  denied := false;
  begin perform public.decide_studio_membership_request(v_mid, 'reject');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: solicitud resuelta decidida dos veces'; end if;

  -- artists_db.studio_id solo apunta a un estudio con vínculo activo.
  perform set_config('request.jwt.claim.sub', v_x::text, true);
  if (select a.studio_id from public.artists_db a where a.user_id = v_x) is distinct from v_studio_a then
    raise exception 'QA: el estudio principal del artista no se sincronizó';
  end if;
  update public.artists_db set studio_id = v_studio_b where user_id = v_x;
  if (select a.studio_id from public.artists_db a where a.user_id = v_x) is distinct from v_studio_a then
    raise exception 'QA: el artista apuntó a un estudio sin vínculo activo';
  end if;
  update public.artists_db set studio_id = null where user_id = v_x;
  if (select a.studio_id from public.artists_db a where a.user_id = v_x) is not null then
    raise exception 'QA: el artista no pudo limpiar su estudio';
  end if;
  update public.artists_db set studio_id = v_studio_a where user_id = v_x;
  if (select a.studio_id from public.artists_db a where a.user_id = v_x) is distinct from v_studio_a then
    raise exception 'QA: el artista no pudo apuntar a su estudio activo';
  end if;

  denied := false;
  begin perform public.withdraw_studio_membership_request(v_mid);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: se retiró un vínculo activo como solicitud'; end if;

  -- Retirar: solo el artista de la fila.
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  denied := false;
  begin perform public.withdraw_studio_membership_request(v_mid_u);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: otro artista retiró la solicitud'; end if;
  perform set_config('request.jwt.claim.sub', v_x::text, true);
  perform public.withdraw_studio_membership_request(v_mid_u);
  if (select m.status from public.studio_artist_memberships m where m.id = v_mid_u) is distinct from 'ended' then
    raise exception 'QA: la solicitud retirada no quedó ended';
  end if;

  -- Rechazo y espera de 72 h antes de volver a pedir.
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  v_mid_y := (public.request_studio_membership(v_studio_a, 'resident') ->> 'membership_id')::uuid;
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_res := public.decide_studio_membership_request(v_mid_y, 'reject');
  if v_res ->> 'status' is distinct from 'rejected' then raise exception 'QA: rechazo inválido: %', v_res; end if;
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  denied := false;
  begin perform public.request_studio_membership(v_studio_a, 'guest');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: nueva solicitud antes de 72 h'; end if;

  -- El estudio puede rechazar directo una solicitud (requested → rejected).
  v_req_yb := (public.request_studio_membership(v_studio_b, 'resident') ->> 'membership_id')::uuid;
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  update public.studio_artist_memberships set status = 'rejected', ended_at = now() where id = v_req_yb;
  if (select m.status from public.studio_artist_memberships m where m.id = v_req_yb) is distinct from 'rejected' then
    raise exception 'QA: el estudio no pudo rechazar la solicitud';
  end if;

  -- Pausa y reanudación directas; terminar solo por RPC.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  update public.studio_artist_memberships set status = 'paused' where id = v_mid;
  update public.studio_artist_memberships set status = 'active' where id = v_mid;
  denied := false;
  begin update public.studio_artist_memberships set status = 'ended' where id = v_mid;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: vínculo activo terminado sin RPC'; end if;
  if (select m.status from public.studio_artist_memberships m where m.id = v_mid) is distinct from 'active' then
    raise exception 'QA: la pausa y reanudación no dejaron el vínculo activo';
  end if;

  perform set_config('qa_aff.mid_x_a', v_mid::text, true);
end $$;

-- ---------------------------------------------------------------------
-- M1 · roster público y grants vistos desde anon
-- ---------------------------------------------------------------------
reset role;
set local role anon;
do $$
declare
  v_studio_a uuid := current_setting('qa_aff.studio_a')::uuid;
  v_x uuid := current_setting('qa_aff.artist_x')::uuid;
  v_n integer;
  denied boolean;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  select count(*) into v_n from public.studio_artist_memberships m where m.studio_id = v_studio_a;
  if v_n <> 0 then raise exception 'QA: anon lee membresías (% filas)', v_n; end if;
  select count(*) into v_n from public.studio_public_roster r where r.studio_id = v_studio_a and r.artist_user_id = v_x;
  if v_n <> 1 then raise exception 'QA: el roster público no muestra al residente activo'; end if;
  if exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'studio_public_roster'
      and c.column_name in ('revenue_split_pct', 'notes')
  ) then
    raise exception 'QA: el roster público expone reparto o notas';
  end if;
  denied := false;
  begin
    insert into public.studio_public_roster (membership_id, studio_id, artist_user_id, role)
    values (gen_random_uuid(), v_studio_a, v_x, 'resident');
  -- Con el join de M2 la vista no es auto-actualizable (55000); sin él, anon no tiene INSERT (42501).
  exception when insufficient_privilege or object_not_in_prerequisite_state then denied := true; end;
  if not denied then raise exception 'QA: anon escribe a través del roster público'; end if;
  denied := false;
  begin perform public.request_studio_membership(v_studio_a);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: anon ejecuta request_studio_membership'; end if;
  select count(*) into v_n from public.list_unowned_studios('QA ROLLBACK Catalogo');
  if v_n < 2 then raise exception 'QA: anon no puede buscar estudios sin dueño en el registro'; end if;
end $$;

-- ---------------------------------------------------------------------
-- M1 · studios protegidos, reclamos y parche del registro
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
do $$
declare
  v_owner_a uuid := current_setting('qa_aff.owner_a')::uuid;
  v_owner_b uuid := current_setting('qa_aff.owner_b')::uuid;
  v_x uuid := current_setting('qa_aff.artist_x')::uuid;
  v_z uuid := current_setting('qa_aff.artist_z')::uuid;
  v_support uuid := current_setting('qa_aff.support')::uuid;
  v_claimant uuid := current_setting('qa_aff.claimant')::uuid;
  v_unconfirmed uuid := current_setting('qa_aff.unconfirmed')::uuid;
  v_studio_a uuid := current_setting('qa_aff.studio_a')::uuid;
  v_catalog uuid := current_setting('qa_aff.catalog')::uuid;
  v_catalog2 uuid := current_setting('qa_aff.catalog2')::uuid;
  v_claim uuid; v_claim2 uuid; v_new_studio uuid; v_res jsonb; v_row public.studios;
  denied boolean;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- is_verified y user_id no los toca el dueño.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  denied := false;
  begin update public.studios set is_verified = true where id = v_studio_a;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: el dueño se autoverificó'; end if;
  denied := false;
  begin update public.studios set user_id = v_owner_b where id = v_studio_a;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: el dueño transfirió el estudio'; end if;
  update public.studios set tagline = 'QA ROLLBACK tagline' where id = v_studio_a;
  if (select s.tagline from public.studios s where s.id = v_studio_a) is distinct from 'QA ROLLBACK tagline' then
    raise exception 'QA: el dueño no puede editar su perfil';
  end if;

  -- Sin studios_anyone_create_via_app: un estudio con dueño no se inserta directo.
  perform set_config('request.jwt.claim.sub', v_x::text, true);
  denied := false;
  begin
    insert into public.studios (name, normalized_name, user_id)
    values ('QA ROLLBACK propio', 'QA ROLLBACK PROPIO ' || gen_random_uuid(), v_x);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: insert directo de un estudio con dueño'; end if;
  insert into public.studios (name, normalized_name, is_verified)
  values ('QA ROLLBACK ficha', 'QA ROLLBACK FICHA ' || gen_random_uuid(), true)
  returning id into v_new_studio;
  if (select s.is_verified from public.studios s where s.id = v_new_studio) is distinct from false then
    raise exception 'QA: una ficha de catálogo nació verificada';
  end if;

  -- Reclamo: validaciones.
  perform set_config('request.jwt.claim.sub', v_unconfirmed::text, true);
  denied := false;
  begin perform public.request_studio_claim(v_catalog, 'Soy la dueña');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: reclamo sin email confirmado'; end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  denied := false;
  begin perform public.request_studio_claim(v_catalog, 'Soy el dueño');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: un dueño reclamó un segundo estudio'; end if;

  perform set_config('request.jwt.claim.sub', v_claimant::text, true);
  denied := false;
  begin perform public.request_studio_claim(v_studio_a, 'Es mío');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: reclamo de un estudio que ya tiene dueño'; end if;
  denied := false;
  begin perform public.request_studio_claim(v_catalog, '   ');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: reclamo sin evidencia'; end if;

  if not exists (select 1 from public.list_unowned_studios('QA ROLLBACK Catalogo Uno') u where u.id = v_catalog) then
    raise exception 'QA: el buscador no encuentra la ficha sin dueño';
  end if;
  if exists (select 1 from public.list_unowned_studios('Q')) then
    raise exception 'QA: el buscador acepta consultas de 1 carácter';
  end if;

  v_claim := public.request_studio_claim(v_catalog, 'Soy la dueña: IG @qa-rollback', 'QA Dueña', '+54 11 5555-0000');
  if public.request_studio_claim(v_catalog, 'Reintento') is distinct from v_claim then
    raise exception 'QA: el reclamo no es idempotente';
  end if;
  if not exists (select 1 from public.studio_claim_requests c where c.id = v_claim and c.status = 'pending') then
    raise exception 'QA: el usuario no ve su reclamo';
  end if;

  perform set_config('request.jwt.claim.sub', v_z::text, true);
  denied := false;
  begin perform public.request_studio_claim(v_catalog, 'También es mío');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: dos reclamos pendientes para la misma ficha'; end if;
  if exists (select 1 from public.studio_claim_requests c where c.id = v_claim) then
    raise exception 'QA: otro usuario ve un reclamo ajeno';
  end if;

  -- Solo soporte decide.
  perform set_config('request.jwt.claim.sub', v_claimant::text, true);
  denied := false;
  begin perform public.decide_studio_claim(v_claim, 'approve');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: el reclamante aprobó su reclamo'; end if;
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  denied := false;
  begin perform public.decide_studio_claim(v_claim, 'approve');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: un dueño de estudio aprobó un reclamo'; end if;

  perform set_config('request.jwt.claim.sub', v_support::text, true);
  denied := false;
  begin perform public.decide_studio_claim(v_claim, 'maybe');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: decisión de reclamo inválida aceptada'; end if;
  v_res := public.decide_studio_claim(v_claim, 'approve', 'Verificado por QA');
  if v_res ->> 'status' is distinct from 'approved' then raise exception 'QA: aprobación de reclamo inválida: %', v_res; end if;
  select * into v_row from public.studios s where s.id = v_catalog;
  if v_row.user_id is distinct from v_claimant
     or v_row.email is distinct from current_setting('qa_aff.claimant_email')
     or v_row.profile_complete is distinct from false then
    raise exception 'QA: la aprobación no asignó dueño, email y perfil incompleto';
  end if;
  denied := false;
  begin perform public.decide_studio_claim(v_claim, 'reject');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: un reclamo resuelto se decidió dos veces'; end if;
  update public.studios set is_verified = true where id = v_catalog;
  if (select s.is_verified from public.studios s where s.id = v_catalog) is distinct from true then
    raise exception 'QA: soporte no pudo verificar el estudio';
  end if;

  perform set_config('request.jwt.claim.sub', v_claimant::text, true);
  if exists (select 1 from public.list_unowned_studios('QA ROLLBACK Catalogo Uno') u where u.id = v_catalog) then
    raise exception 'QA: el estudio reclamado sigue en el buscador';
  end if;
  if (select c.status from public.studio_claim_requests c where c.id = v_claim) is distinct from 'approved' then
    raise exception 'QA: el reclamante no ve su reclamo aprobado';
  end if;

  -- Rechazo con nota.
  perform set_config('request.jwt.claim.sub', v_z::text, true);
  v_claim2 := public.request_studio_claim(v_catalog2, 'Tengo el contrato de alquiler');
  perform set_config('request.jwt.claim.sub', v_support::text, true);
  perform public.decide_studio_claim(v_claim2, 'reject', 'Faltan pruebas');
  if (select s.user_id from public.studios s where s.id = v_catalog2) is not null then
    raise exception 'QA: un reclamo rechazado asignó dueño';
  end if;
  perform set_config('request.jwt.claim.sub', v_z::text, true);
  if (select c.status || ':' || coalesce(c.decision_note, '') from public.studio_claim_requests c where c.id = v_claim2)
     is distinct from 'rejected:Faltan pruebas' then
    raise exception 'QA: el rechazo no guardó estado y nota';
  end if;

  -- Registrar un estudio con el nombre de una ficha sin dueño ofrece reclamarla.
  denied := false;
  begin
    perform public.complete_studio_registration(
      jsonb_build_object('name', current_setting('qa_aff.catalog2_name')),
      '[{"label":"Principal","formatted_address":"Calle QA 1","city":"Rosario","country":"Argentina","is_primary":true}]'::jsonb);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: el registro duplicó una ficha sin dueño'; end if;
end $$;

-- ---------------------------------------------------------------------
-- M2 · postulación → borrador → emisión → firma, versiones y rescisión
-- ---------------------------------------------------------------------
do $$
declare
  v_owner_a uuid := current_setting('qa_aff.owner_a')::uuid;
  v_owner_b uuid := current_setting('qa_aff.owner_b')::uuid;
  v_x uuid := current_setting('qa_aff.artist_x')::uuid;
  v_y uuid := current_setting('qa_aff.artist_y')::uuid;
  v_support uuid := current_setting('qa_aff.support')::uuid;
  v_studio_a uuid := current_setting('qa_aff.studio_a')::uuid;
  v_studio_b uuid := current_setting('qa_aff.studio_b')::uuid;
  v_loc_a uuid := current_setting('qa_aff.loc_a')::uuid;
  v_loc_b uuid := current_setting('qa_aff.loc_b')::uuid;
  v_spot_a uuid := current_setting('qa_aff.spot_a')::uuid;
  v_spot_a2 uuid := current_setting('qa_aff.spot_a2')::uuid;
  v_spot_b uuid := current_setting('qa_aff.spot_b')::uuid;
  v_ended_xb uuid := current_setting('qa_aff.ended_xb')::uuid;
  v_app uuid; v_c1 uuid; v_c2 uuid; v_mem uuid; v_number text;
  v_spot_start date; v_spot_end date;
  v_row public.studio_contracts; v_res jsonb; v_n integer;
  denied boolean;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Guard de postulaciones.
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  denied := false;
  begin
    insert into public.studio_spot_applications (spot_id, artist_user_id, status) values (v_spot_a, v_y, 'accepted');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: una postulación nació aceptada'; end if;
  insert into public.studio_spot_applications (spot_id, artist_user_id, message)
  values (v_spot_a, v_y, 'Me encantaría hacer el guest')
  returning id into v_app;
  denied := false;
  begin update public.studio_spot_applications set status = 'accepted' where id = v_app;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: el artista aceptó su propia postulación'; end if;
  denied := false;
  begin update public.studio_spot_applications set spot_id = v_spot_a2 where id = v_app;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: el artista movió la postulación de spot'; end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  denied := false;
  begin update public.studio_spot_applications set status = 'accepted' where id = v_app;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: el estudio aceptó una postulación sin contrato'; end if;
  update public.studio_spot_applications set status = 'viewed' where id = v_app;
  denied := false;
  begin update public.studio_spot_applications set message = 'Editado por el estudio' where id = v_app;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: el estudio editó el mensaje del artista'; end if;

  -- decide_studio_spot_application: cross-tenant, argumento e idempotencia.
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  denied := false;
  begin perform public.decide_studio_spot_application(v_app, 'accepted');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: otro estudio decidió la postulación'; end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  denied := false;
  begin perform public.decide_studio_spot_application(v_app, 'bogus');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: decisión de postulación inválida aceptada'; end if;
  if (public.decide_studio_spot_application(v_app, 'accepted')).status is distinct from 'shortlisted' then
    raise exception 'QA: aceptar no preseleccionó la postulación';
  end if;
  perform public.decide_studio_spot_application(v_app, 'accepted');
  select count(*) into v_n from public.studio_contracts c where c.application_id = v_app and c.status = 'draft';
  if v_n <> 1 then raise exception 'QA: aceptar dos veces no es idempotente (% borradores)', v_n; end if;
  select * into v_row from public.studio_contracts c where c.application_id = v_app and c.status = 'draft';
  v_c1 := v_row.id;
  select sp.start_date, sp.end_date into v_spot_start, v_spot_end from public.studio_spots sp where sp.id = v_spot_a;
  if v_row.origin is distinct from 'spot_application' or v_row.role is distinct from 'guest'
     or v_row.compensation_model is distinct from 'percentage' or v_row.artist_percentage is distinct from 60.00
     or not ('Hospedaje' = any (v_row.includes))
     or v_row.perks is distinct from array['Agenda garantizada']
     or v_row.artist_obligations is distinct from array['Cuatro días por semana']
     or v_row.contract_number !~ '^C-[0-9]{4}-[0-9]{4}$' or v_row.version is distinct from 1
     or v_row.start_date is distinct from v_spot_start or v_row.end_date is distinct from v_spot_end
     or v_row.location_id is distinct from v_loc_a or v_row.artist_user_id is distinct from v_y then
    raise exception 'QA: borrador mal armado desde el spot: %', to_jsonb(v_row);
  end if;
  if exists (
    select 1 from public.studio_artist_memberships m
    where m.studio_id = v_studio_a and m.artist_user_id = v_y and m.status = 'active'
  ) then
    raise exception 'QA: aceptar creó una membresía antes de firmar';
  end if;

  -- El artista no ve ni firma borradores.
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  if exists (select 1 from public.studio_contracts c where c.id = v_c1) then
    raise exception 'QA: el artista ve un borrador';
  end if;
  denied := false;
  begin perform public.sign_studio_contract(v_c1, 'Yanina QA', true);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: se firmó un borrador'; end if;

  -- save_studio_contract_draft: dueño, pertenencia cruzada y valores.
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  denied := false;
  begin perform public.save_studio_contract_draft(jsonb_build_object('id', v_c1, 'terms', 'Cambio ajeno'));
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: otro estudio editó el borrador'; end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  foreach v_res in array array[
    jsonb_build_object('id', v_c1, 'location_id', v_loc_b),
    jsonb_build_object('id', v_c1, 'membership_id', v_ended_xb),
    jsonb_build_object('id', v_c1, 'spot_id', v_spot_b),
    jsonb_build_object('id', v_c1, 'studio_id', v_studio_b),
    jsonb_build_object('id', v_c1, 'artist_user_id', v_x),
    jsonb_build_object('id', v_c1, 'includes', (select jsonb_agg('Ítem ' || g) from generate_series(1, 21) g)),
    jsonb_build_object('id', v_c1, 'perks', jsonb_build_array('Agenda', '   ')),
    jsonb_build_object('id', v_c1, 'artist_percentage', 120),
    jsonb_build_object('id', v_c1, 'fixed_currency', 'pesos'),
    jsonb_build_object('id', v_c1, 'start_date', current_date + 10, 'end_date', current_date + 1)
  ] loop
    denied := false;
    begin perform public.save_studio_contract_draft(v_res);
    exception when invalid_parameter_value then denied := true; end;
    if not denied then raise exception 'QA: el borrador aceptó un valor inválido o de otro estudio: %', v_res; end if;
  end loop;

  -- Borradores relajados; emitir exige la modalidad completa.
  perform public.save_studio_contract_draft(jsonb_build_object('id', v_c1, 'compensation_model', 'fixed'));
  denied := false;
  begin perform public.issue_studio_contract(v_c1, 'Ana Dueña');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: se emitió con la modalidad incompleta'; end if;
  perform public.save_studio_contract_draft(jsonb_build_object(
    'id', v_c1, 'compensation_model', 'percentage', 'artist_percentage', 60,
    'house_rules', 'Respetar los horarios del estudio', 'cancellation_notice_days', 15));

  perform set_config('request.jwt.claim.sub', v_support::text, true);
  denied := false;
  begin perform public.issue_studio_contract(v_c1, 'Soporte QA');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: soporte emitió en nombre del estudio'; end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  denied := false;
  begin perform public.issue_studio_contract(v_c1, 'AB');
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: firma del estudio sin nombre completo'; end if;
  v_res := public.issue_studio_contract(v_c1, 'Ana Dueña');
  if (v_res ->> 'status') is distinct from 'sent'
     or (v_res ->> 'terms_hash') !~ '^[0-9a-f]{64}$'
     or (v_res -> 'terms_snapshot' -> 'artist' ->> 'email') is distinct from current_setting('qa_aff.artist_y_email')
     or (v_res -> 'terms_snapshot' -> 'studio' ->> 'slug') is distinct from current_setting('qa_aff.slug_a')
     or (v_res -> 'terms_snapshot' ->> 'studio_signer_name') is distinct from 'Ana Dueña'
     or (v_res ->> 'expires_at')::timestamptz <= now() then
    raise exception 'QA: emisión inválida: %', v_res;
  end if;
  denied := false;
  begin perform public.save_studio_contract_draft(jsonb_build_object('id', v_c1, 'terms', 'Cambio tardío'));
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: se editó un contrato emitido'; end if;

  -- Firma del artista.
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  if not exists (select 1 from public.studio_contracts c where c.id = v_c1 and c.status = 'sent') then
    raise exception 'QA: el artista no ve el contrato enviado';
  end if;
  perform set_config('request.jwt.claim.sub', v_x::text, true);
  denied := false;
  begin perform public.sign_studio_contract(v_c1, 'Xavier QA', true);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: otro artista firmó el contrato'; end if;

  perform set_config('request.jwt.claim.sub', v_y::text, true);
  denied := false;
  begin perform public.sign_studio_contract(v_c1, 'Yanina QA', false);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: firma sin aceptar los términos'; end if;
  denied := false;
  begin perform public.sign_studio_contract(v_c1, 'Yo', true);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: firma con nombre incompleto'; end if;

  v_res := public.sign_studio_contract(v_c1, 'Yanina QA', true);
  v_mem := (v_res ->> 'membership_id')::uuid;
  if (v_res ->> 'contract_id')::uuid is distinct from v_c1 or v_mem is null then
    raise exception 'QA: respuesta de firma inválida: %', v_res;
  end if;
  if not exists (
    select 1 from public.studio_artist_memberships m
    where m.id = v_mem and m.studio_id = v_studio_a and m.status = 'active' and m.role = 'guest'
      and m.current_contract_id = v_c1 and m.revenue_split_pct = 60 and m.initiated_by = 'studio'
  ) then
    raise exception 'QA: la firma no dejó la membresía activa con el contrato';
  end if;
  if (select a.status from public.studio_spot_applications a where a.id = v_app) is distinct from 'accepted' then
    raise exception 'QA: la firma no aceptó la postulación';
  end if;
  if (select c.status || ':' || c.artist_signer_name from public.studio_contracts c where c.id = v_c1)
     is distinct from 'signed:Yanina QA' then
    raise exception 'QA: el contrato no quedó firmado por el artista';
  end if;
  denied := false;
  begin perform public.sign_studio_contract(v_c1, 'Yanina QA', true);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: un contrato se firmó dos veces'; end if;
  if (public.get_current_contract_for_membership(v_mem) ->> 'id')::uuid is distinct from v_c1 then
    raise exception 'QA: get_current_contract_for_membership no devuelve el firmado';
  end if;
  if (select r.ends_on from public.studio_public_roster r where r.membership_id = v_mem) is distinct from v_spot_end then
    raise exception 'QA: el roster público no muestra la vigencia del contrato';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  denied := false;
  begin perform public.get_current_contract_for_membership(v_mem);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: otro estudio lee el contrato vigente'; end if;

  -- Con contrato vigente, rol y reparto se congelan; sede y notas no.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  denied := false;
  begin update public.studio_artist_memberships set revenue_split_pct = 70 where id = v_mem;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: reparto editable con contrato vigente'; end if;
  denied := false;
  begin update public.studio_artist_memberships set role = 'resident' where id = v_mem;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: rol editable con contrato vigente'; end if;
  denied := false;
  begin update public.studio_artist_memberships set current_contract_id = null where id = v_mem;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: current_contract_id editable desde el cliente'; end if;
  update public.studio_artist_memberships set notes = 'QA ROLLBACK nota' where id = v_mem;
  if (select m.notes from public.studio_artist_memberships m where m.id = v_mem) is distinct from 'QA ROLLBACK nota' then
    raise exception 'QA: las notas no se pueden editar con contrato vigente';
  end if;

  -- Nueva versión: mismo número, versión 2; reemplaza al firmado.
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  denied := false;
  begin
    perform public.save_studio_contract_draft(jsonb_build_object(
      'studio_id', v_studio_b, 'artist_user_id', v_y, 'supersedes_contract_id', v_c1, 'role', 'guest'));
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: nueva versión de un contrato de otro estudio'; end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_c2 := public.save_studio_contract_draft(jsonb_build_object(
    'studio_id', v_studio_a, 'artist_user_id', v_y, 'supersedes_contract_id', v_c1, 'origin', 'manual',
    'compensation_model', 'percentage', 'artist_percentage', 70,
    'start_date', v_spot_start, 'end_date', v_spot_end + 30,
    'includes', jsonb_build_array('Estación propia', 'Hospedaje'),
    'status', 'signed', 'unknown_key', 'se ignora'));
  select * into v_row from public.studio_contracts c where c.id = v_c2;
  select c.contract_number into v_number from public.studio_contracts c where c.id = v_c1;
  if v_row.contract_number is distinct from v_number or v_row.version is distinct from 2
     or v_row.membership_id is distinct from v_mem or v_row.role is distinct from 'guest'
     or v_row.status is distinct from 'draft' or v_row.supersedes_contract_id is distinct from v_c1 then
    raise exception 'QA: nueva versión mal armada: %', to_jsonb(v_row);
  end if;
  perform public.issue_studio_contract(v_c2, 'Ana Dueña');
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  perform public.sign_studio_contract(v_c2, 'Yanina QA', true);
  if (select c.status || ':' || coalesce(c.termination_reason, '') from public.studio_contracts c where c.id = v_c1)
     not like 'terminated:Reemplazado por C-%' then
    raise exception 'QA: la versión anterior no quedó reemplazada';
  end if;
  if not exists (
    select 1 from public.studio_artist_memberships m
    where m.id = v_mem and m.status = 'active' and m.current_contract_id = v_c2 and m.revenue_split_pct = 70
  ) then
    raise exception 'QA: la nueva versión no actualizó la membresía';
  end if;
  if (select r.ends_on from public.studio_public_roster r where r.membership_id = v_mem) is distinct from v_spot_end + 30 then
    raise exception 'QA: el roster público no muestra la nueva vigencia';
  end if;

  -- Rescisión: partes o soporte, con motivo; termina el vínculo.
  perform set_config('request.jwt.claim.sub', v_x::text, true);
  denied := false;
  begin perform public.terminate_studio_contract(v_c2, 'No soy parte', true);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: un tercero rescindió el contrato'; end if;
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  denied := false;
  begin perform public.terminate_studio_contract(v_c2, '   ', true);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: rescisión sin motivo'; end if;
  v_res := public.terminate_studio_contract(v_c2, 'Me mudo de ciudad', true);
  if (v_res ->> 'status') is distinct from 'terminated' or (v_res ->> 'terminated_by')::uuid is distinct from v_y then
    raise exception 'QA: rescisión inválida: %', v_res;
  end if;
  if not exists (
    select 1 from public.studio_artist_memberships m
    where m.id = v_mem and m.status = 'ended' and m.current_contract_id is null
  ) then
    raise exception 'QA: la rescisión no terminó el vínculo';
  end if;
  denied := false;
  begin perform public.terminate_studio_contract(v_c2, 'Otra vez', true);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: un contrato rescindido se rescindió dos veces'; end if;

  perform set_config('qa_aff.app_y_a', v_app::text, true);
  perform set_config('qa_aff.contract_c1', v_c1::text, true);
end $$;

-- ---------------------------------------------------------------------
-- M2 · invitaciones y solicitudes con contrato, contraofertas y retiros
-- ---------------------------------------------------------------------
do $$
declare
  v_owner_a uuid := current_setting('qa_aff.owner_a')::uuid;
  v_owner_b uuid := current_setting('qa_aff.owner_b')::uuid;
  v_x uuid := current_setting('qa_aff.artist_x')::uuid;
  v_y uuid := current_setting('qa_aff.artist_y')::uuid;
  v_z uuid := current_setting('qa_aff.artist_z')::uuid;
  v_studio_a uuid := current_setting('qa_aff.studio_a')::uuid;
  v_studio_b uuid := current_setting('qa_aff.studio_b')::uuid;
  v_spot_a2 uuid := current_setting('qa_aff.spot_a2')::uuid;
  v_c1 uuid := current_setting('qa_aff.contract_c1')::uuid;
  v_inv_x uuid; v_mgr uuid; v_req_xb uuid; v_req_zb uuid; v_app_x uuid; v_app_y2 uuid;
  v_c3 uuid; v_c4 uuid; v_c5 uuid; v_c6 uuid; v_c7 uuid;
  v_offer public.studio_spot_counter_offers; v_row public.studio_contracts;
  denied boolean;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Invitación con contrato: no se acepta sin firmar; rechazarla lo declina.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  insert into public.studio_artist_memberships (studio_id, artist_user_id, role, status, invited_at)
  values (v_studio_a, v_x, 'guest', 'pending_acceptance', now())
  returning id into v_inv_x;
  v_c3 := public.prepare_contract_for_membership(v_inv_x);
  if public.prepare_contract_for_membership(v_inv_x) is distinct from v_c3 then
    raise exception 'QA: preparar dos veces duplicó el borrador de la invitación';
  end if;
  select * into v_row from public.studio_contracts c where c.id = v_c3;
  if v_row.origin is distinct from 'invitation' or v_row.role is distinct from 'guest'
     or v_row.membership_id is distinct from v_inv_x then
    raise exception 'QA: borrador de invitación mal armado: %', to_jsonb(v_row);
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  denied := false;
  begin perform public.prepare_contract_for_membership(v_inv_x);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: otro estudio preparó un contrato ajeno'; end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform public.save_studio_contract_draft(jsonb_build_object(
    'id', v_c3, 'compensation_model', 'fixed', 'fixed_amount', 50000, 'fixed_currency', 'ars',
    'fixed_period', 'monthly', 'fixed_payer', 'artist_to_studio', 'start_date', current_date + 3));
  if (select c.fixed_currency from public.studio_contracts c where c.id = v_c3) is distinct from 'ARS' then
    raise exception 'QA: la moneda no se normalizó a ISO';
  end if;
  perform public.issue_studio_contract(v_c3, 'Ana Dueña');

  perform set_config('request.jwt.claim.sub', v_x::text, true);
  denied := false;
  begin perform public.respond_to_studio_invitation(v_inv_x, 'accept');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: se aceptó una invitación con contrato pendiente de firma'; end if;
  perform public.respond_to_studio_invitation(v_inv_x, 'reject');
  if (select c.status from public.studio_contracts c where c.id = v_c3) is distinct from 'declined' then
    raise exception 'QA: rechazar la invitación no declinó el contrato';
  end if;
  if (select m.status from public.studio_artist_memberships m where m.id = v_inv_x) is distinct from 'rejected' then
    raise exception 'QA: la invitación no quedó rechazada';
  end if;

  -- Los managers no llevan contrato.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  insert into public.studio_artist_memberships (studio_id, artist_user_id, role, status, invited_at)
  values (v_studio_a, v_z, 'manager', 'pending_acceptance', now())
  returning id into v_mgr;
  denied := false;
  begin perform public.prepare_contract_for_membership(v_mgr);
  exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'QA: contrato de spot para un manager'; end if;

  -- Solicitud del artista → contrato 'request' → firma → fin del vínculo.
  perform set_config('request.jwt.claim.sub', v_x::text, true);
  v_req_xb := (public.request_studio_membership(v_studio_b, 'resident') ->> 'membership_id')::uuid;
  denied := false;
  begin perform public.respond_to_studio_invitation(v_req_xb, 'accept');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: el artista aprobó su propia solicitud'; end if;

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  v_c4 := public.prepare_contract_for_membership(v_req_xb);
  if (select c.origin from public.studio_contracts c where c.id = v_c4) is distinct from 'request' then
    raise exception 'QA: el contrato de una solicitud no quedó con origen request';
  end if;
  perform public.save_studio_contract_draft(jsonb_build_object(
    'id', v_c4, 'compensation_model', 'percentage', 'artist_percentage', 55, 'start_date', current_date + 1));
  perform public.issue_studio_contract(v_c4, 'Beto Dueño');
  perform set_config('request.jwt.claim.sub', v_x::text, true);
  perform public.sign_studio_contract(v_c4, 'Xavier QA', true);
  if not exists (
    select 1 from public.studio_artist_memberships m
    where m.id = v_req_xb and m.status = 'active' and m.initiated_by = 'artist'
      and m.current_contract_id = v_c4 and m.revenue_split_pct = 55
  ) then
    raise exception 'QA: firmar el contrato de la solicitud no activó el vínculo';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  perform public.end_studio_membership(v_req_xb);
  if (select c.status || ':' || coalesce(c.termination_reason, '') from public.studio_contracts c where c.id = v_c4)
     is distinct from 'terminated:Vínculo finalizado' then
    raise exception 'QA: terminar el vínculo no rescindió el contrato';
  end if;
  if not exists (
    select 1 from public.studio_artist_memberships m
    where m.id = v_req_xb and m.status = 'ended' and m.current_contract_id is null
  ) then
    raise exception 'QA: terminar el vínculo no limpió el contrato vigente';
  end if;

  -- Rechazar una solicitud cancela su borrador.
  perform set_config('request.jwt.claim.sub', v_z::text, true);
  v_req_zb := (public.request_studio_membership(v_studio_b) ->> 'membership_id')::uuid;
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  v_c5 := public.prepare_contract_for_membership(v_req_zb);
  perform public.decide_studio_membership_request(v_req_zb, 'reject');
  if (select c.status from public.studio_contracts c where c.id = v_c5) is distinct from 'cancelled' then
    raise exception 'QA: rechazar la solicitud no canceló el borrador';
  end if;

  -- Rechazar la postulación cancela su borrador.
  perform set_config('request.jwt.claim.sub', v_x::text, true);
  insert into public.studio_spot_applications (spot_id, artist_user_id) values (v_spot_a2, v_x)
  returning id into v_app_x;
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform public.decide_studio_spot_application(v_app_x, 'accepted');
  select c.id into v_c6 from public.studio_contracts c where c.application_id = v_app_x and c.status = 'draft';
  if v_c6 is null then raise exception 'QA: aceptar la postulación no preparó borrador'; end if;
  perform public.decide_studio_spot_application(v_app_x, 'rejected');
  if (select c.status from public.studio_contracts c where c.id = v_c6) is distinct from 'cancelled' then
    raise exception 'QA: rechazar la postulación no canceló el borrador';
  end if;
  if (select a.status from public.studio_spot_applications a where a.id = v_app_x) is distinct from 'rejected' then
    raise exception 'QA: la postulación no quedó rechazada';
  end if;

  -- Contraoferta aceptada: preselecciona y fija el split; spot con stipend → mixto.
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  insert into public.studio_spot_applications (spot_id, artist_user_id) values (v_spot_a2, v_y)
  returning id into v_app_y2;
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_offer := public.create_studio_spot_counter_offer(v_app_y2, 'studio', 55, null, null, 'Te ofrecemos 55%');
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  perform public.respond_to_studio_spot_counter_offer(v_offer.id, 'accept');
  if (select a.status from public.studio_spot_applications a where a.id = v_app_y2) is distinct from 'shortlisted' then
    raise exception 'QA: aceptar la contraoferta no dejó la postulación preseleccionada';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_c7 := public.prepare_contract_from_application(v_app_y2);
  select * into v_row from public.studio_contracts c where c.id = v_c7;
  if v_row.compensation_model is distinct from 'mixed' or v_row.artist_percentage is distinct from 55.00
     or v_row.fixed_amount is distinct from 1000.00 or v_row.fixed_currency is distinct from 'USD'
     or v_row.fixed_period is distinct from 'weekly' or v_row.fixed_payer is distinct from 'studio_to_artist'
     or v_row.role is distinct from 'resident' then
    raise exception 'QA: borrador mixto mal armado: %', to_jsonb(v_row);
  end if;
  perform public.issue_studio_contract(v_c7, 'Ana Dueña');

  -- Retirar la postulación cancela el contrato enviado.
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  update public.studio_spot_applications set status = 'withdrawn' where id = v_app_y2;
  if (select c.status from public.studio_contracts c where c.id = v_c7) is distinct from 'cancelled' then
    raise exception 'QA: retirar la postulación no canceló el contrato';
  end if;
  if (select a.decided_at from public.studio_spot_applications a where a.id = v_app_y2) is null then
    raise exception 'QA: el retiro no registró la fecha';
  end if;

  -- Un contrato rescindido no se cancela.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  denied := false;
  begin perform public.cancel_studio_contract(v_c1);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: se canceló un contrato que ya no estaba abierto'; end if;
end $$;

-- ---------------------------------------------------------------------
-- M2 · efectos: inbox y viaje (como postgres)
-- ---------------------------------------------------------------------
reset role;
do $$
declare
  v_x uuid := current_setting('qa_aff.artist_x')::uuid;
  v_y uuid := current_setting('qa_aff.artist_y')::uuid;
  v_c1 uuid := current_setting('qa_aff.contract_c1')::uuid;
  v_app uuid := current_setting('qa_aff.app_y_a')::uuid;
  v_mid uuid := current_setting('qa_aff.mid_x_a')::uuid;
  v_thread uuid;
begin
  select t.id into v_thread
  from public.inbox_threads t
  where t.artist_user_id = v_y and t.context_type = 'studio_contract' and t.context_id = v_c1;
  if v_thread is null then raise exception 'QA: el contrato no abrió hilo en el inbox del artista'; end if;
  if (select t.category || '|' || (t.context ->> 'deeplink') from public.inbox_threads t where t.id = v_thread)
     is distinct from 'invitations|/artist/invitations?contrato=' || v_c1::text then
    raise exception 'QA: el hilo del contrato no tiene categoría o deeplink correctos';
  end if;
  if not exists (select 1 from public.inbox_messages m where m.thread_id = v_thread and m.body like 'Firmaste el contrato %') then
    raise exception 'QA: el inbox no registró la firma';
  end if;
  if not exists (
    select 1 from public.inbox_messages m
    join public.inbox_threads t on t.id = m.thread_id
    where t.artist_user_id = v_x and t.context_type = 'studio_invitation' and t.context_id = v_mid
      and m.body like 'Solicitud enviada a %'
  ) or not exists (
    select 1 from public.inbox_messages m
    join public.inbox_threads t on t.id = m.thread_id
    where t.artist_user_id = v_x and t.context_type = 'studio_invitation' and t.context_id = v_mid
      and m.body like '% aprobó tu solicitud.'
  ) then
    raise exception 'QA: el inbox no registró la solicitud y su aprobación';
  end if;
  if not exists (
    select 1 from public.artist_trips t where t.source_type = 'spot_application' and t.source_id = v_app
  ) then
    raise exception 'QA: firmar el contrato del spot no creó el viaje';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- M2 · vencimientos, cancelación y rechazo del artista
-- ---------------------------------------------------------------------
set local role authenticated;
do $$
declare
  v_owner_a uuid := current_setting('qa_aff.owner_a')::uuid;
  v_y uuid := current_setting('qa_aff.artist_y')::uuid;
  v_studio_a uuid := current_setting('qa_aff.studio_a')::uuid;
  v_inv_yr uuid; v_c8 uuid;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  insert into public.studio_artist_memberships (studio_id, artist_user_id, role, status, invited_at)
  values (v_studio_a, v_y, 'resident', 'pending_acceptance', now())
  returning id into v_inv_yr;
  v_c8 := public.prepare_contract_for_membership(v_inv_yr);
  perform public.save_studio_contract_draft(jsonb_build_object(
    'id', v_c8, 'compensation_model', 'percentage', 'artist_percentage', 65, 'start_date', current_date + 2));
  perform public.issue_studio_contract(v_c8, 'Ana Dueña');
  perform set_config('qa_aff.inv_yr', v_inv_yr::text, true);
  perform set_config('qa_aff.contract_c8', v_c8::text, true);
end $$;

-- Fixture: el contrato enviado ya venció.
reset role;
update public.studio_contracts
set expires_at = now() - interval '1 minute'
where id = current_setting('qa_aff.contract_c8')::uuid;

set local role authenticated;
do $$
declare
  v_owner_a uuid := current_setting('qa_aff.owner_a')::uuid;
  v_owner_b uuid := current_setting('qa_aff.owner_b')::uuid;
  v_y uuid := current_setting('qa_aff.artist_y')::uuid;
  v_studio_a uuid := current_setting('qa_aff.studio_a')::uuid;
  v_inv_yr uuid := current_setting('qa_aff.inv_yr')::uuid;
  v_c8 uuid := current_setting('qa_aff.contract_c8')::uuid;
  v_inv_yi uuid; v_c9 uuid; v_c10 uuid; v_c11 uuid;
  denied boolean;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform set_config('request.jwt.claim.sub', v_y::text, true);
  denied := false;
  begin perform public.sign_studio_contract(v_c8, 'Yanina QA', true);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: se firmó un contrato vencido'; end if;

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  denied := false;
  begin perform public.expire_studio_contracts(v_studio_a);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: otro estudio venció contratos ajenos'; end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  if public.expire_studio_contracts(v_studio_a) < 1 then
    raise exception 'QA: expire_studio_contracts no venció el contrato enviado';
  end if;
  if (select c.status from public.studio_contracts c where c.id = v_c8) is distinct from 'expired' then
    raise exception 'QA: el contrato vencido no quedó expired';
  end if;

  perform set_config('request.jwt.claim.sub', v_y::text, true);
  denied := false;
  begin perform public.decline_studio_contract(v_c8, 'Tarde');
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: se rechazó un contrato vencido'; end if;

  -- Cancelación: solo el estudio y solo desde draft/sent.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_c9 := public.prepare_contract_for_membership(v_inv_yr);
  if v_c9 = v_c8 then raise exception 'QA: un contrato vencido se reutilizó como borrador'; end if;
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  denied := false;
  begin perform public.cancel_studio_contract(v_c9);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'QA: el artista canceló un contrato del estudio'; end if;
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  if (public.cancel_studio_contract(v_c9, 'Cambio de planes') ->> 'status') is distinct from 'cancelled' then
    raise exception 'QA: la cancelación no dejó el contrato cancelled';
  end if;
  denied := false;
  begin perform public.cancel_studio_contract(v_c9);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: un contrato se canceló dos veces'; end if;

  -- Fin de vigencia: el firmado con end_date pasada termina el vínculo.
  v_c10 := public.prepare_contract_for_membership(v_inv_yr);
  perform public.save_studio_contract_draft(jsonb_build_object(
    'id', v_c10, 'compensation_model', 'percentage', 'artist_percentage', 65,
    'start_date', current_date - 30, 'end_date', current_date - 1));
  perform public.issue_studio_contract(v_c10, 'Ana Dueña');
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  perform public.sign_studio_contract(v_c10, 'Yanina QA', true);
  if not exists (
    select 1 from public.studio_artist_memberships m
    where m.id = v_inv_yr and m.status = 'active' and m.current_contract_id = v_c10
  ) then
    raise exception 'QA: firmar la invitación no activó el vínculo';
  end if;
  denied := false;
  begin perform public.decline_studio_contract(v_c10);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'QA: se rechazó un contrato firmado'; end if;
  if public.expire_studio_contracts() < 1 then
    raise exception 'QA: el artista no venció su contrato con fin de vigencia';
  end if;
  if (select c.status || ':' || coalesce(c.termination_reason, '') from public.studio_contracts c where c.id = v_c10)
     is distinct from 'terminated:Fin de vigencia' then
    raise exception 'QA: el fin de vigencia no rescindió el contrato';
  end if;
  if not exists (
    select 1 from public.studio_artist_memberships m
    where m.id = v_inv_yr and m.status = 'ended' and m.current_contract_id is null
  ) then
    raise exception 'QA: el fin de vigencia no terminó el vínculo';
  end if;

  -- El artista rechaza el contrato y después acepta la invitación sin contrato.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  insert into public.studio_artist_memberships (studio_id, artist_user_id, role, status, invited_at)
  values (v_studio_a, v_y, 'itinerant', 'pending_acceptance', now())
  returning id into v_inv_yi;
  v_c11 := public.prepare_contract_for_membership(v_inv_yi);
  perform public.save_studio_contract_draft(jsonb_build_object(
    'id', v_c11, 'compensation_model', 'percentage', 'artist_percentage', 50, 'start_date', current_date + 20));
  perform public.issue_studio_contract(v_c11, 'Ana Dueña', now() + interval '3 days');
  perform set_config('request.jwt.claim.sub', v_y::text, true);
  if (public.decline_studio_contract(v_c11, 'No me sirven las fechas') ->> 'status') is distinct from 'declined' then
    raise exception 'QA: el rechazo del artista no dejó el contrato declined';
  end if;
  if (select m.status from public.studio_artist_memberships m where m.id = v_inv_yi) is distinct from 'pending_acceptance' then
    raise exception 'QA: rechazar el contrato cerró la invitación';
  end if;
  if (public.respond_to_studio_invitation(v_inv_yi, 'accept') ->> 'status') is distinct from 'active' then
    raise exception 'QA: la invitación sin contrato pendiente no se pudo aceptar';
  end if;
end $$;
reset role;
select 'PASS: membership guard, requests/72 h, public roster, artist pointer, studios guard, claims, registration patch, spot→draft→issue→sign, versions, termination, invitation/request contracts, counter-offers, withdrawal, cancellation, expiry and contract inbox' as result;
rollback;
