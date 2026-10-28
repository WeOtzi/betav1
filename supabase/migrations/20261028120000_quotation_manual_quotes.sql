-- Figma final del flujo de artista (oct 2026) · área "cotizaciones".
-- Nueva cotización manual (/my-quotations/new, frames 801:556 y 801:557).
--
-- Aditiva e idempotente. NO aplicada: el frontend degrada si falta (guarda el
-- borrador en el navegador y avisa que la creación necesita esta migración).
--
-- 1. artist_clients
--    Libreta de clientes del artista: "El cliente no está registrado, crearlo
--    ahora". Un cliente de la libreta NO es un usuario de la plataforma; cuando
--    esa persona se registra con el mismo correo, el mecanismo existente de
--    claim por email (quotations_db.client_email) le muestra sus cotizaciones.
-- 2. artist_manual_quotes
--    Borradores y detalle económico de cada cotización manual: conceptos con
--    cantidad y precio, descuento, impuestos, seña, vigencia, política de
--    cancelación, notas y términos. quotations_db no tiene dónde guardar el
--    desglose (solo artist_budget_amount). 1:1 con quotations_db por quote_id
--    una vez enviada.
-- 3. create_manual_quotation(p_quote jsonb, p_details jsonb)
--    Crea en una sola transacción la fila de quotations_db (estado responded,
--    source manual), el detalle en artist_manual_quotes y, si viene de "Nueva
--    cita" con fecha tentativa, la primera sesión en quotation_sessions.
--    security definer: valida que quien llama sea artista y fuerza artist_id,
--    source y estado del lado del servidor (no hace falta abrir el INSERT de
--    quotations_db a los artistas).

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Libreta de clientes del artista
-- ---------------------------------------------------------------------------
create table if not exists public.artist_clients (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  email text check (email is null or (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  whatsapp text check (whatsapp is null or char_length(whatsapp) <= 40),
  instagram text check (instagram is null or char_length(instagram) <= 60),
  city text check (city is null or char_length(city) <= 120),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists artist_clients_artist_email_uq
  on public.artist_clients (artist_id, lower(email)) where email is not null;
create index if not exists artist_clients_artist_created_idx
  on public.artist_clients (artist_id, created_at desc);

comment on table public.artist_clients is
  'Libreta de clientes del artista (alta desde la cotización manual). No son usuarios de la plataforma.';

alter table public.artist_clients enable row level security;

drop policy if exists artist_clients_owner_select on public.artist_clients;
create policy artist_clients_owner_select on public.artist_clients
  for select to authenticated using (artist_id = auth.uid());
drop policy if exists artist_clients_owner_insert on public.artist_clients;
create policy artist_clients_owner_insert on public.artist_clients
  for insert to authenticated with check (artist_id = auth.uid());
drop policy if exists artist_clients_owner_update on public.artist_clients;
create policy artist_clients_owner_update on public.artist_clients
  for update to authenticated using (artist_id = auth.uid()) with check (artist_id = auth.uid());
drop policy if exists artist_clients_owner_delete on public.artist_clients;
create policy artist_clients_owner_delete on public.artist_clients
  for delete to authenticated using (artist_id = auth.uid());

revoke all on public.artist_clients from anon;
grant select, insert, update, delete on public.artist_clients to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cotizaciones manuales: borrador + detalle económico
-- ---------------------------------------------------------------------------
create table if not exists public.artist_manual_quotes (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  quote_ref text not null unique check (quote_ref ~ '^COT-[A-Z0-9]{4,12}$'),
  status text not null default 'draft' check (status in ('draft', 'sent')),
  origin text not null default 'manual' check (origin in ('manual', 'cliente', 'cita')),
  artist_client_id uuid references public.artist_clients(id) on delete set null,
  -- quotations_db.quote_id una vez enviada (igual a quote_ref).
  quote_id text unique,
  -- { name, email, whatsapp, instagram, city }
  client jsonb not null default '{}'::jsonb check (jsonb_typeof(client) = 'object'),
  -- { title, description, style, body_part, size, color, complexity, cover_up,
  --   sessions, session_hours, location, tentative_date, priority }
  project jsonb not null default '{}'::jsonb check (jsonb_typeof(project) = 'object'),
  -- [{ name, description, qty, price, total }]
  line_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(line_items) = 'array' and jsonb_array_length(line_items) <= 50),
  currency text not null default 'ARS' check (currency ~ '^[A-Z]{3}$'),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_pct numeric(5,2) not null default 0 check (tax_pct between 0 and 100),
  deposit_pct numeric(5,2) not null default 30 check (deposit_pct between 0 and 100),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  deposit_amount numeric(14,2) not null default 0 check (deposit_amount >= 0),
  validity_days integer not null default 14 check (validity_days between 1 and 365),
  cancellation_policy text not null default 'no-reembolsable-48' check (char_length(cancellation_policy) <= 60),
  client_notes text check (client_notes is null or char_length(client_notes) <= 4000),
  extra_terms text check (extra_terms is null or char_length(extra_terms) <= 4000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  constraint artist_manual_quotes_sent_has_quote check (status = 'draft' or quote_id is not null)
);

create index if not exists artist_manual_quotes_artist_status_idx
  on public.artist_manual_quotes (artist_id, status, updated_at desc);

comment on table public.artist_manual_quotes is
  'Cotizaciones manuales del artista: borradores y desglose económico (conceptos, descuento, impuestos, seña, condiciones).';

alter table public.artist_manual_quotes enable row level security;

-- El artista ve todas las suyas; edita y borra solo borradores. El paso a
-- "sent" lo hace únicamente create_manual_quotation.
drop policy if exists artist_manual_quotes_owner_select on public.artist_manual_quotes;
create policy artist_manual_quotes_owner_select on public.artist_manual_quotes
  for select to authenticated using (artist_id = auth.uid());
drop policy if exists artist_manual_quotes_owner_insert on public.artist_manual_quotes;
create policy artist_manual_quotes_owner_insert on public.artist_manual_quotes
  for insert to authenticated
  with check (artist_id = auth.uid() and status = 'draft' and quote_id is null);
drop policy if exists artist_manual_quotes_owner_update on public.artist_manual_quotes;
create policy artist_manual_quotes_owner_update on public.artist_manual_quotes
  for update to authenticated
  using (artist_id = auth.uid() and status = 'draft')
  with check (artist_id = auth.uid() and status = 'draft' and quote_id is null);
drop policy if exists artist_manual_quotes_owner_delete on public.artist_manual_quotes;
create policy artist_manual_quotes_owner_delete on public.artist_manual_quotes
  for delete to authenticated using (artist_id = auth.uid() and status = 'draft');
-- El cliente registrado ve el desglose de las cotizaciones que recibió.
drop policy if exists artist_manual_quotes_client_select on public.artist_manual_quotes;
create policy artist_manual_quotes_client_select on public.artist_manual_quotes
  for select to authenticated
  using (
    status = 'sent'
    and exists (
      select 1 from public.quotations_db q
      where q.quote_id = artist_manual_quotes.quote_id
        and q.client_user_id = auth.uid()
    )
  );

revoke all on public.artist_manual_quotes from anon;
grant select, insert, update, delete on public.artist_manual_quotes to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Creación atómica de la cotización manual
-- ---------------------------------------------------------------------------
create or replace function public.create_manual_quotation(p_quote jsonb, p_details jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- Un borrador de otro artista con la misma referencia bloquea la creación.
  if exists (select 1 from public.artist_manual_quotes m where m.quote_ref = v_ref and (m.artist_id <> v_uid or m.status = 'sent')) then
    raise exception 'La referencia ya está en uso.' using errcode = '23505';
  end if;

  -- El cliente de la libreta tiene que ser del mismo artista.
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
  -- Vincula al cliente registrado por correo (mismo criterio que el claim).
  q.client_user_id := null;
  if q.client_email is not null then
    select c.user_id into q.client_user_id
      from public.clients_db c
     where lower(c.email) = q.client_email
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

  -- "Nueva cita" del dashboard: agenda la primera sesión en la fecha tentativa.
  if coalesce((v_details->>'schedule_session')::boolean, false)
     and nullif(v_details->'project'->>'tentative_date', '') is not null then
    v_session_at := ((v_details->'project'->>'tentative_date')::date + time '11:00') at time zone 'America/Argentina/Buenos_Aires';
    insert into public.quotation_sessions (quotation_id, session_number, session_date, duration_hours, status, notes)
    values (
      saved.id, null, v_session_at,
      nullif(v_details->'project'->>'session_hours', '')::numeric,
      'scheduled', 'Cita tentativa · cotización manual ' || saved.quote_id
    );
  end if;

  return jsonb_build_object('id', saved.id, 'quote_id', saved.quote_id, 'status', saved.quote_status);
end;
$$;

revoke all on function public.create_manual_quotation(jsonb, jsonb) from public, anon;
grant execute on function public.create_manual_quotation(jsonb, jsonb) to authenticated;

comment on function public.create_manual_quotation(jsonb, jsonb) is
  'Crea una cotización manual del artista (quotations_db + artist_manual_quotes + sesión tentativa opcional).';

commit;
