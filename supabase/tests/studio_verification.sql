-- Run after 20261102120000_studio_verification as postgres. Existing data is
-- only read; every fixture ("QA ROLLBACK") and state change is rolled back.
-- Covers: name keys and matches, find_studio_matches (anon, exact / similar /
-- instagram, own studio excluded), registration with matches (same address
-- refused, other address → verification required), identical names, the
-- verification guard, request_studio_verification and decide_studio_verification.
begin;
reset role;
do $$
declare
  v_tag text := left(replace(gen_random_uuid()::text, '-', ''), 8);
  v_owner uuid := gen_random_uuid();
  v_new1 uuid := gen_random_uuid();
  v_new2 uuid := gen_random_uuid();
  v_new3 uuid := gen_random_uuid();
  v_support uuid := gen_random_uuid();
  v_studio uuid; v_catalog uuid;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_owner, 'authenticated', 'authenticated', 'qa-ver-owner-' || v_owner || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now()),
    (v_new1, 'authenticated', 'authenticated', 'qa-ver-new1-' || v_new1 || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now()),
    (v_new2, 'authenticated', 'authenticated', 'qa-ver-new2-' || v_new2 || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now()),
    (v_new3, 'authenticated', 'authenticated', 'qa-ver-new3-' || v_new3 || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now()),
    (v_support, 'authenticated', 'authenticated', 'qa-ver-support-' || v_support || '@example.invalid', now(), '{}'::jsonb, '{"user_type":"studio"}'::jsonb, now(), now());
  insert into public.support_users_db (user_id, email, full_name, role, is_active)
  values (v_support, 'qa-ver-support-' || v_support || '@example.invalid', 'QA ROLLBACK soporte', 'support', true);

  insert into public.studios (user_id, name, normalized_name, slug, instagram, is_active)
  values (v_owner, 'Claroscuro Qa' || v_tag, upper('Claroscuro Qa' || v_tag), 'qa-ver-' || v_tag, '@qaver' || v_tag, true)
  returning id into v_studio;
  insert into public.studio_locations (studio_id, label, formatted_address, city, country, latitude, longitude, is_primary)
  values (v_studio, 'Sede QA', 'Av. QA ' || v_tag || ' 910, Acassuso', 'Acassuso', 'Argentina', -34.4800, -58.5000, true);
  insert into public.studios (name, normalized_name, slug, is_active)
  values ('Catalogo Qa' || v_tag, upper('Catalogo Qa' || v_tag), 'qa-ver-cat-' || v_tag, true)
  returning id into v_catalog;

  perform set_config('qa_ver.tag', v_tag, true);
  perform set_config('qa_ver.owner', v_owner::text, true);
  perform set_config('qa_ver.new1', v_new1::text, true);
  perform set_config('qa_ver.new2', v_new2::text, true);
  perform set_config('qa_ver.new3', v_new3::text, true);
  perform set_config('qa_ver.support', v_support::text, true);
  perform set_config('qa_ver.studio', v_studio::text, true);
  perform set_config('qa_ver.catalog', v_catalog::text, true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------
-- Claves y coincidencias de nombre
-- ---------------------------------------------------------------------
do $$
begin
  if private.studio_name_key('  Estudio  Ñandú-Tattoo ') <> 'estudio nandu tattoo' then
    raise exception 'QA: studio_name_key no normaliza acentos y separadores';
  end if;
  if private.studio_name_tokens('Estudio Ñandú Tattoo') <> array['nandu'] then
    raise exception 'QA: studio_name_tokens no quita las palabras genéricas';
  end if;
  if private.studio_name_match('Claroscuro', 'CLAROSCURO') is distinct from 'exact' then raise exception 'QA: exact'; end if;
  if private.studio_name_match('Claroscuro', 'Claroscuro Tattoo Studio') is distinct from 'similar' then raise exception 'QA: tokens similares'; end if;
  if private.studio_name_match('Claroscuro', 'ClaroscuroBA') is distinct from 'similar' then raise exception 'QA: contención'; end if;
  if private.studio_name_match('Sur Tattoo House', 'Sur Ink') is not null then raise exception 'QA: Sur House ≠ Sur Ink'; end if;
  if private.studio_name_match('Bang Bang NYC', 'Bang Bang') is distinct from 'similar' then raise exception 'QA: Bang Bang'; end if;
  if private.studio_instagram_key('https://www.instagram.com/Claro.Scuro/?hl=es') <> 'claro.scuro' then
    raise exception 'QA: studio_instagram_key con URL';
  end if;
  if private.studio_instagram_key('@@Claro') <> 'claro' then raise exception 'QA: studio_instagram_key con @'; end if;
  if private.approx_distance_m(-34.48, -58.5, -34.4801, -58.5) not between 9 and 13 then
    raise exception 'QA: approx_distance_m fuera de rango';
  end if;
  -- Calle y número (20261102140000_studio_address_match).
  if private.studio_street_key('Gorriti 4800, Palermo, CABA') <> 'gorriti 4800' then raise exception 'QA: studio_street_key'; end if;
  if private.studio_street_key('Palermo, CABA') is not null then raise exception 'QA: studio_street_key sin número'; end if;
  if not private.studio_address_conflict(
       '{"formatted_address":"Gorriti 4800, C1414 Cdad. Autónoma de Buenos Aires, Argentina","latitude":-34.5907952,"longitude":-58.4292052}'::jsonb,
       'Gorriti 4800, Palermo, CABA, Argentina', 'Buenos Aires', -34.5889, -58.4306) then
    raise exception 'QA: misma calle y número a 250 m no coincide';
  end if;
  if private.studio_address_conflict(
       '{"formatted_address":"Gorriti 4800, Rosario, Santa Fe","latitude":-32.95,"longitude":-60.65}'::jsonb,
       'Gorriti 4800, Palermo, CABA, Argentina', 'Buenos Aires', -34.5889, -58.4306) then
    raise exception 'QA: misma calle en otra ciudad (300 km) coincide';
  end if;
  if not private.studio_address_conflict('{"formatted_address":"Gorriti 4800, CABA","city":"Buenos Aires"}'::jsonb,
       'Gorriti 4800, Palermo', 'Buenos Aires', null, null) then
    raise exception 'QA: misma calle y ciudad sin coordenadas no coincide';
  end if;
  if private.studio_address_conflict('{"formatted_address":"Gorriti 4801, CABA","latitude":-34.6,"longitude":-58.43}'::jsonb,
       'Gorriti 4800, Palermo', 'Buenos Aires', -34.5889, -58.4306) then
    raise exception 'QA: otro número a más de 40 m coincide';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- find_studio_matches (anon y dueño)
-- ---------------------------------------------------------------------
set local role anon;
do $$
declare
  v_tag text := current_setting('qa_ver.tag');
  v_studio uuid := current_setting('qa_ver.studio')::uuid;
  v_res jsonb;
begin
  v_res := public.find_studio_matches('claroscuro qa' || v_tag, null);
  if not exists (select 1 from jsonb_array_elements(v_res) e where (e->>'id')::uuid = v_studio and e->>'match' = 'exact' and (e->>'owned')::boolean) then
    raise exception 'QA: find_studio_matches no devuelve la coincidencia exacta: %', v_res;
  end if;
  if jsonb_array_length((select e->'locations' from jsonb_array_elements(v_res) e where (e->>'id')::uuid = v_studio)) <> 1 then
    raise exception 'QA: find_studio_matches no trae las sedes';
  end if;
  v_res := public.find_studio_matches('Claroscuro Qa' || v_tag || ' Tattoo', null);
  if not exists (select 1 from jsonb_array_elements(v_res) e where (e->>'id')::uuid = v_studio and e->>'match' = 'similar') then
    raise exception 'QA: find_studio_matches no devuelve la coincidencia parecida';
  end if;
  v_res := public.find_studio_matches('Nombre totalmente distinto ' || v_tag, 'https://instagram.com/QAVER' || v_tag);
  if not exists (select 1 from jsonb_array_elements(v_res) e where (e->>'id')::uuid = v_studio and e->>'match' = 'instagram') then
    raise exception 'QA: find_studio_matches no detecta el Instagram';
  end if;
  if public.find_studio_matches('x', null) <> '[]'::jsonb then raise exception 'QA: nombre corto'; end if;
  -- Fichas sin dueño también aparecen para visitas anónimas (20261102130000).
  v_res := public.find_studio_matches('Catalogo Qa' || v_tag, null);
  if not exists (select 1 from jsonb_array_elements(v_res) e
                 where (e->>'id')::uuid = current_setting('qa_ver.catalog')::uuid and e->>'match' = 'exact' and not (e->>'owned')::boolean) then
    raise exception 'QA: find_studio_matches no devuelve la ficha sin dueño a anon: %', v_res;
  end if;
  begin
    perform 1 from public.studio_verification_requests;
    raise exception 'QA: anon lee solicitudes de verificación';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
do $$
declare
  v_tag text := current_setting('qa_ver.tag');
  v_studio uuid := current_setting('qa_ver.studio')::uuid;
begin
  perform set_config('request.jwt.claim.sub', current_setting('qa_ver.owner'), true);
  if exists (select 1 from jsonb_array_elements(public.find_studio_matches('Claroscuro Qa' || v_tag, null)) e where (e->>'id')::uuid = v_studio) then
    raise exception 'QA: find_studio_matches devuelve el estudio de quien pregunta';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------
-- Registro con coincidencias
-- ---------------------------------------------------------------------
set local role authenticated;
do $$
declare
  v_tag text := current_setting('qa_ver.tag');
  v_matched uuid := current_setting('qa_ver.studio')::uuid;
  v_s public.studios;
  v_req public.studio_verification_requests;
  denied boolean;
begin
  -- Parecido + misma dirección (a ~5 m): se rechaza.
  perform set_config('request.jwt.claim.sub', current_setting('qa_ver.new1'), true);
  denied := false;
  begin
    perform public.complete_studio_registration(
      jsonb_build_object('name', 'Claroscuro Qa' || v_tag || ' Tattoo'),
      jsonb_build_array(jsonb_build_object('label', 'Sede principal', 'formatted_address', 'Otra 1', 'city', 'Acassuso', 'country', 'Argentina',
        'latitude', -34.48004, 'longitude', -58.5, 'is_primary', true, 'is_active', true)));
  exception when exclusion_violation then denied := true;
  end;
  if not denied then raise exception 'QA: el registro parecido en la misma dirección no se rechazó'; end if;

  -- Misma dirección formateada sin coordenadas: también.
  denied := false;
  begin
    perform public.complete_studio_registration(
      jsonb_build_object('name', 'Claroscuro Qa' || v_tag || ' Tattoo'),
      jsonb_build_array(jsonb_build_object('label', 'Sede principal', 'formatted_address', 'Av. QA ' || v_tag || ' 910, ACASSUSO', 'city', 'Acassuso', 'country', 'Argentina',
        'is_primary', true, 'is_active', true)));
  exception when exclusion_violation then denied := true;
  end;
  if not denied then raise exception 'QA: la misma dirección formateada no se rechazó'; end if;

  -- Misma calle y número con otro texto y coordenadas a ~250 m: también.
  denied := false;
  begin
    perform public.complete_studio_registration(
      jsonb_build_object('name', 'Claroscuro Qa' || v_tag || ' Tattoo'),
      jsonb_build_array(jsonb_build_object('label', 'Sede principal', 'formatted_address', 'Av. QA ' || v_tag || ' 910, B1641 San Isidro, Provincia de Buenos Aires',
        'city', 'San Isidro', 'country', 'Argentina', 'latitude', -34.4822, 'longitude', -58.5005, 'is_primary', true, 'is_active', true)));
  exception when exclusion_violation then denied := true;
  end;
  if not denied then raise exception 'QA: la misma calle y número no se rechazó'; end if;

  -- Parecido en otra dirección: se crea con verificación adicional.
  v_s := public.complete_studio_registration(
    jsonb_build_object('name', 'Claroscuro Qa' || v_tag || ' Tattoo'),
    jsonb_build_array(jsonb_build_object('label', 'Sede principal', 'formatted_address', 'Calle Lejana 50', 'city', 'Córdoba', 'country', 'Argentina',
      'latitude', -31.4, 'longitude', -64.18, 'is_primary', true, 'is_active', true)));
  if not v_s.verification_required or v_s.verification_reason <> 'name_match' or v_s.verification_status <> 'pending' or v_s.is_verified then
    raise exception 'QA: el registro parecido no quedó con verificación adicional: % % %', v_s.verification_required, v_s.verification_reason, v_s.verification_status;
  end if;
  select * into v_req from public.studio_verification_requests r where r.studio_id = v_s.id;
  if not found or v_req.status <> 'pending' or not (v_matched = any (v_req.matched_studio_ids)) or v_req.reasons <> array['name_match'] then
    raise exception 'QA: la solicitud de verificación del registro no quedó bien';
  end if;

  -- Nombre idéntico a un estudio con dueño.
  perform set_config('request.jwt.claim.sub', current_setting('qa_ver.new2'), true);
  denied := false;
  begin
    perform public.complete_studio_registration(
      jsonb_build_object('name', 'CLAROSCURO QA' || upper(v_tag)),
      jsonb_build_array(jsonb_build_object('label', 'Sede', 'formatted_address', 'Calle 9', 'city', 'Salta', 'country', 'Argentina', 'is_primary', true, 'is_active', true)));
  exception when unique_violation then denied := true;
  end;
  if not denied then raise exception 'QA: el nombre idéntico no se rechazó con 23505'; end if;

  -- Nombre de una ficha sin dueño: se ofrece reclamarla (M1).
  denied := false;
  begin
    perform public.complete_studio_registration(
      jsonb_build_object('name', 'Catalogo Qa' || v_tag),
      jsonb_build_array(jsonb_build_object('label', 'Sede', 'formatted_address', 'Calle 9', 'city', 'Salta', 'country', 'Argentina', 'is_primary', true, 'is_active', true)));
  exception when check_violation then denied := sqlerrm ilike '%reclamalo%';
  end;
  if not denied then raise exception 'QA: la ficha sin dueño no ofrece el reclamo'; end if;

  -- Sin coincidencias: verificación no requerida.
  perform set_config('request.jwt.claim.sub', current_setting('qa_ver.new3'), true);
  v_s := public.complete_studio_registration(
    jsonb_build_object('name', 'Zzyzx Original ' || v_tag),
    jsonb_build_array(jsonb_build_object('label', 'Sede', 'formatted_address', 'Calle 10', 'city', 'Salta', 'country', 'Argentina', 'is_primary', true, 'is_active', true)));
  if v_s.verification_required or v_s.verification_status <> 'unverified' then
    raise exception 'QA: un estudio sin coincidencias quedó con verificación requerida';
  end if;
  perform set_config('qa_ver.studio_new3', v_s.id::text, true);
end $$;
reset role;

-- ---------------------------------------------------------------------
-- Guard, pedido y decisión
-- ---------------------------------------------------------------------
set local role authenticated;
do $$
declare
  v_studio uuid := current_setting('qa_ver.studio_new3')::uuid;
  v_other uuid := current_setting('qa_ver.studio')::uuid;
  v_req uuid;
  v_res jsonb;
  denied boolean;
begin
  perform set_config('request.jwt.claim.sub', current_setting('qa_ver.new3'), true);
  denied := false;
  begin
    update public.studios set verification_status = 'verified' where id = v_studio;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'QA: el dueño se autoverificó'; end if;
  denied := false;
  begin
    update public.studios set instagram_verified_at = now() where id = v_studio;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'QA: el dueño marcó su Instagram como validado'; end if;

  denied := false;
  begin
    perform public.request_studio_verification(v_other, 'Soy el dueño de este estudio, de verdad.');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'QA: se pidió la verificación de un estudio ajeno'; end if;
  denied := false;
  begin
    perform public.request_studio_verification(v_studio, 'corto');
  exception when invalid_parameter_value then denied := true;
  end;
  if not denied then raise exception 'QA: evidencia corta aceptada'; end if;
  denied := false;
  begin
    perform public.request_studio_verification(v_studio, 'Habilitación municipal 1234 a nombre del estudio.', null, null, array['javascript:alert(1)']);
  exception when invalid_parameter_value then denied := true;
  end;
  if not denied then raise exception 'QA: enlace no http aceptado'; end if;

  v_req := public.request_studio_verification(v_studio, 'Habilitación municipal 1234 a nombre del estudio.', 'QA', '+54 11 1234',
    array['https://instagram.com/qa', 'https://instagram.com/qa']);
  if (select status from public.studio_verification_requests where id = v_req) <> 'pending'
     or (select cardinality(links) from public.studio_verification_requests where id = v_req) <> 1
     or (select verification_status from public.studios where id = v_studio) <> 'pending' then
    raise exception 'QA: el pedido de verificación no quedó pendiente';
  end if;
  if public.request_studio_verification(v_studio, 'Segundo intento con más datos del estudio.') <> v_req then
    raise exception 'QA: un segundo pedido no reutilizó la solicitud pendiente';
  end if;
  perform set_config('qa_ver.req', v_req::text, true);

  denied := false;
  begin
    perform public.decide_studio_verification(v_req, 'approve', null);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'QA: el dueño decidió su propia verificación'; end if;

  perform set_config('request.jwt.claim.sub', current_setting('qa_ver.support'), true);
  denied := false;
  begin
    perform public.decide_studio_verification(v_req, 'reject', null);
  exception when invalid_parameter_value then denied := true;
  end;
  if not denied then raise exception 'QA: rechazo sin motivo aceptado'; end if;
  v_res := public.decide_studio_verification(v_req, 'approve', 'Documentación revisada.');
  if v_res->>'status' <> 'approved'
     or (select is_verified from public.studios where id = v_studio) is not true
     or (select verification_status from public.studios where id = v_studio) <> 'verified' then
    raise exception 'QA: aprobar no verificó el estudio';
  end if;
  denied := false;
  begin
    perform public.decide_studio_verification(v_req, 'reject', 'otra vez');
  exception when check_violation then denied := true;
  end;
  if not denied then raise exception 'QA: se decidió dos veces la misma solicitud'; end if;

  perform set_config('request.jwt.claim.sub', current_setting('qa_ver.new3'), true);
  denied := false;
  begin
    perform public.request_studio_verification(v_studio, 'Pido de nuevo la verificación del estudio.');
  exception when check_violation then denied := true;
  end;
  if not denied then raise exception 'QA: un estudio verificado volvió a pedir verificación'; end if;
  if (select count(*) from public.studio_verification_requests) <> 1 then
    raise exception 'QA: el dueño ve solicitudes de otros estudios';
  end if;
end $$;
reset role;

select 'PASS: name keys, find_studio_matches, registration matches (address refused / verification required), identical names, guard, request and decision' as result;
rollback;
