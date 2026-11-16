-- ============================================================================
-- Cotización manual · solo se vincula a una cuenta con el correo verificado
-- ============================================================================
-- Desde la 2.5.1 (20261117100000) una cotización con cuenta de cliente
-- vinculada (quotations_db.client_user_id) solo queda aprobada cuando el
-- cliente la acepta en la app. Por eso importa a qué cuenta se vincula.
--
-- create_manual_quotation (cotización manual y "Nueva cita" del artista)
-- vinculaba la primera fila de clients_db con el mismo correo, sin mirar si la
-- cuenta lo había confirmado. Una cuenta sin confirmar (o una cuenta de QA con
-- la marca qa_unverified_email) no puede aceptar la propuesta: el artista
-- quedaba sin poder cerrar el acuerdo.
--
-- Ahora usa el mismo filtro que link_quotation_contact (20261116110200) y que
-- isEmailVerified en lib/cot-cliente.js: correo de auth.users igual al de la
-- cotización, confirmado, sin borrar, no anónimo y sin la marca de QA (en
-- app_metadata ni en user_metadata). Sin esa cuenta, la cotización nace sin
-- dueño y el artista registra el acuerdo como en cualquier cotización de
-- invitado; cuando el cliente confirma su correo se vincula sola
-- (link_client_quotations_on_email_confirm, 20261115140000).
--
-- Copia literal de la función viva (pg_get_functiondef, 16 nov 2026; difiere
-- de 20261115120300 solo en un comentario). Único cambio: el bloque que carga
-- q.client_user_id.
--
-- Idempotente (create or replace; los grants se conservan). Puede aplicarse
-- antes o después de publicar el código 2.5.2: no cambia la firma ni la
-- respuesta de la función.
-- Reversa: supabase/rollbacks/20261117110000_manual_quote_vinculo_cuenta_verificada.down.sql
-- ============================================================================

begin;

create or replace function public.create_manual_quotation(p_quote jsonb, p_details jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_artist record;
  v_ref text := upper(btrim(coalesce(p_quote->>'quote_id', '')));
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_total numeric := coalesce(nullif(v_details->>'total', '')::numeric, 0);
  v_client_id uuid;
  v_origin text := coalesce(nullif(v_details->>'origin', ''), 'manual');
  q public.quotations_db;
  saved public.quotations_db;
  v_session_at timestamptz;
  v_tentative_at text := nullif(btrim(coalesce(v_details->'project'->>'tentative_at', '')), '');
  v_tentative_date text := nullif(btrim(coalesce(v_details->'project'->>'tentative_date', '')), '');
begin
  if v_uid is null then
    raise exception 'Iniciá sesión para crear cotizaciones.' using errcode = '28000';
  end if;

  select a.user_id, a.name, a.username, a.email, a.instagram, a.city, a.ubicacion
    into v_artist
    from public.artists_db a
   where a.user_id = v_uid
   limit 1;
  if not found then
    raise exception 'Solo un artista puede crear cotizaciones manuales.' using errcode = '42501';
  end if;

  if v_ref !~ '^COT-[A-Z0-9]{4,12}$' then
    raise exception 'Referencia de cotización no válida.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_quote->>'client_full_name'), '') = '' then
    raise exception 'Falta cliente.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_quote->>'project_description'), '') = '' then
    raise exception 'Falta título.' using errcode = '22023';
  end if;
  if v_total <= 0 then
    raise exception 'Falta un concepto con precio.' using errcode = '22023';
  end if;
  if v_origin not in ('manual', 'cliente', 'cita') then
    v_origin := 'manual';
  end if;

  if coalesce((v_details->>'schedule_session')::boolean, false)
     and (v_tentative_at is not null or v_tentative_date is not null) then
    begin
      if v_tentative_at is not null then
        if v_tentative_at !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$' then
          raise exception using errcode = '22007';
        end if;
        v_session_at := v_tentative_at::timestamptz;
      else
        v_session_at := (v_tentative_date::date + time '11:00') at time zone 'America/Argentina/Buenos_Aires';
      end if;
    exception
      when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
        raise exception 'Fecha tentativa no válida.' using errcode = '22023';
    end;
  end if;

  if exists (select 1 from public.artist_manual_quotes m where m.quote_ref = v_ref and (m.artist_id <> v_uid or m.status = 'sent')) then
    raise exception 'La referencia ya está en uso.' using errcode = '23505';
  end if;

  if nullif(v_details->>'artist_client_id', '') is not null then
    select c.id into v_client_id
      from public.artist_clients c
     where c.id = (v_details->>'artist_client_id')::uuid
       and c.artist_id = v_uid;
  end if;

  q := jsonb_populate_record(null::public.quotations_db, p_quote);
  q.quote_id := v_ref;
  q.quote_status := 'responded';
  q.source := 'manual';
  q.quotation_medium := 'manual';
  q.artist_id := v_uid;
  q.artist_name := v_artist.name;
  q.artist_username := v_artist.username;
  q.artist_email := v_artist.email;
  q.artist_instagram := v_artist.instagram;
  q.artist_current_city := coalesce(v_artist.city, v_artist.ubicacion);
  q.artist_budget_amount := v_total;
  q.client_email := nullif(lower(btrim(coalesce(q.client_email, ''))), '');
  q.client_user_id := null;
  -- Solo una cuenta de cliente con el correo VERIFICADO (mismo filtro que
  -- link_quotation_contact, 20261116110200). Si el cliente todavía no
  -- confirmó su correo, la cotización nace sin cuenta y se vincula sola
  -- cuando lo confirma (link_client_quotations_on_email_confirm) o cuando
  -- la reclama con la sesión iniciada.
  if q.client_email is not null then
    select u.id into q.client_user_id
      from auth.users u
      join public.clients_db c on c.user_id = u.id
     where lower(btrim(u.email)) = q.client_email
       and u.email_confirmed_at is not null
       and u.deleted_at is null
       and coalesce(u.is_anonymous, false) = false
       and coalesce(u.raw_app_meta_data->>'qa_unverified_email', 'false') <> 'true'
       and coalesce(u.raw_user_meta_data->>'qa_unverified_email', 'false') <> 'true'
     order by u.created_at
     limit 1;
  end if;

  insert into public.quotations_db (
    quote_id, quote_status, source, quotation_medium,
    artist_id, artist_name, artist_username, artist_email, artist_instagram, artist_current_city, artist_studio_name,
    client_full_name, client_email, client_whatsapp, client_instagram, client_city_residence, client_user_id,
    project_description, tattoo_idea_description, tattoo_style, tattoo_body_part, tattoo_size,
    tattoo_color_type, tattoo_is_cover_up, tattoo_estimated_sessions, client_preferred_date, priority,
    artist_budget_amount, artist_budget_currency, artist_responded_at, sent_to_artist_at
  ) values (
    q.quote_id, q.quote_status, q.source, q.quotation_medium,
    q.artist_id, q.artist_name, q.artist_username, q.artist_email, q.artist_instagram, q.artist_current_city, q.artist_studio_name,
    q.client_full_name, q.client_email, q.client_whatsapp, q.client_instagram, q.client_city_residence, q.client_user_id,
    q.project_description, q.tattoo_idea_description, q.tattoo_style, q.tattoo_body_part, q.tattoo_size,
    q.tattoo_color_type, q.tattoo_is_cover_up, q.tattoo_estimated_sessions, q.client_preferred_date, coalesce(q.priority, 'medium'),
    q.artist_budget_amount, q.artist_budget_currency, timezone('utc', now()), timezone('utc', now())
  )
  returning * into saved;

  insert into public.artist_manual_quotes (
    artist_id, quote_ref, status, origin, artist_client_id, quote_id, client, project, line_items,
    currency, discount_pct, tax_pct, deposit_pct, subtotal, total, deposit_amount,
    validity_days, cancellation_policy, client_notes, extra_terms, sent_at, updated_at
  ) values (
    v_uid, v_ref, 'sent', v_origin, v_client_id, saved.quote_id,
    coalesce(v_details->'client', '{}'::jsonb),
    coalesce(v_details->'project', '{}'::jsonb),
    coalesce(v_details->'line_items', '[]'::jsonb),
    upper(coalesce(nullif(v_details->>'currency', ''), saved.artist_budget_currency, 'ARS')),
    coalesce(nullif(v_details->>'discount_pct', '')::numeric, 0),
    coalesce(nullif(v_details->>'tax_pct', '')::numeric, 0),
    coalesce(nullif(v_details->>'deposit_pct', '')::numeric, 30),
    coalesce(nullif(v_details->>'subtotal', '')::numeric, v_total),
    v_total,
    coalesce(nullif(v_details->>'deposit_amount', '')::numeric, 0),
    coalesce(nullif(v_details->>'validity_days', '')::integer, 14),
    coalesce(nullif(v_details->>'cancellation_policy', ''), 'no-reembolsable-48'),
    nullif(v_details->>'client_notes', ''),
    nullif(v_details->>'extra_terms', ''),
    timezone('utc', now()), timezone('utc', now())
  )
  on conflict (quote_ref) do update set
    status = 'sent', origin = excluded.origin, artist_client_id = excluded.artist_client_id,
    quote_id = excluded.quote_id, client = excluded.client, project = excluded.project,
    line_items = excluded.line_items, currency = excluded.currency,
    discount_pct = excluded.discount_pct, tax_pct = excluded.tax_pct, deposit_pct = excluded.deposit_pct,
    subtotal = excluded.subtotal, total = excluded.total, deposit_amount = excluded.deposit_amount,
    validity_days = excluded.validity_days, cancellation_policy = excluded.cancellation_policy,
    client_notes = excluded.client_notes, extra_terms = excluded.extra_terms,
    sent_at = excluded.sent_at, updated_at = excluded.updated_at
  where artist_manual_quotes.artist_id = v_uid and artist_manual_quotes.status = 'draft';

  if v_session_at is not null then
    insert into public.quotation_sessions (quotation_id, session_number, session_date, duration_hours, status, notes)
    values (
      saved.id, null, v_session_at,
      nullif(v_details->'project'->>'session_hours', '')::numeric,
      'scheduled', 'Cita tentativa · cotización manual ' || saved.quote_id
    );
  end if;

  return jsonb_build_object('id', saved.id, 'quote_id', saved.quote_id, 'status', saved.quote_status);
end;
$function$;

commit;
