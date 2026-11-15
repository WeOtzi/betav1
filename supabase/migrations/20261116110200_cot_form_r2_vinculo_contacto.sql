-- ============================================================================
-- Cotizador web · ronda 2 (frente cot-form) · mismo contacto entre cotizaciones
-- (P17: "si el email y/o el teléfono coinciden con otra cotización, vincularlos")
--
-- Regla de privacidad:
--   · Email con cuenta de cliente VERIFICADA dueña de ese email → la cotización
--     (y las demás de invitado con ese email) se vinculan a esa cuenta
--     (quotations_db.client_user_id). Mismo criterio que
--     link_client_quotations_on_email_confirm (frente cot-cliente).
--   · Teléfono → NUNCA vincula a una cuenta. Solo agrupa cotizaciones como
--     "mismo contacto" (quotation_contact_links.contact_group_id).
--   · El grupo no da acceso a nada: la tabla es privada (RLS sin políticas) y el
--     artista solo ve, entre SUS propias cotizaciones, cuáles son del mismo
--     contacto (rpc quotation_same_contact).
--
-- Objetos:
--   public.quotation_contact_links            quote_id → contact_group_id
--   public.quotation_contact_phone_key(text)  últimos 10 dígitos del teléfono
--   public.link_quotation_contact(text)       lo llama el servidor al enviar
--   public.quotation_same_contact(text)       lectura para el artista dueño / soporte
--
-- Requiere 20261116110000 (short_code) y 20261115140000 (cot_cliente_is_wizard_draft).
-- Idempotente. Rollback: supabase/rollbacks/20261116110200_cot_form_r2_vinculo_contacto.down.sql
-- ============================================================================

begin;

create table if not exists public.quotation_contact_links (
  quote_id text primary key
    references public.quotations_db(quote_id) on update cascade on delete cascade,
  contact_group_id uuid not null,
  -- Huellas (sha256) del email y del teléfono normalizados: alcanzan para
  -- comparar sin duplicar los datos de contacto fuera de quotations_db.
  email_hash text,
  phone_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quotation_contact_links_group_idx on public.quotation_contact_links (contact_group_id);
create index if not exists quotation_contact_links_email_idx on public.quotation_contact_links (email_hash) where email_hash is not null;
create index if not exists quotation_contact_links_phone_idx on public.quotation_contact_links (phone_hash) where phone_hash is not null;

alter table public.quotation_contact_links enable row level security;
-- Sin políticas: ni anon ni authenticated leen o escriben la tabla. La usan el
-- servidor (service role) y las funciones security definer de abajo.
revoke all on table public.quotation_contact_links from public;
revoke all on table public.quotation_contact_links from anon, authenticated;
grant select, insert, update, delete on table public.quotation_contact_links to service_role;

comment on table public.quotation_contact_links is
  'Cotizaciones del mismo contacto (email o teléfono iguales). Privada: se lee con quotation_same_contact().';

-- Últimos 10 dígitos (tolera "+54 9 11…", "011…" y variantes del mismo número).
-- Menos de 8 dígitos no identifica a nadie: null.
create or replace function public.quotation_contact_phone_key(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when char_length(d.digits) < 8 then null
    else right(d.digits, 10)
  end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits) d;
$$;

revoke all on function public.quotation_contact_phone_key(text) from public;
revoke all on function public.quotation_contact_phone_key(text) from anon, authenticated;
grant execute on function public.quotation_contact_phone_key(text) to service_role;

-- ---------------------------------------------------------------------------
-- Vincula una cotización ENVIADA con las demás del mismo contacto y, si el
-- email tiene una cuenta de cliente verificada, con esa cuenta.
-- ---------------------------------------------------------------------------
create or replace function public.link_quotation_contact(p_quote_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q public.quotations_db;
  v_email text;
  v_phone text;
  v_email_hash text;
  v_phone_hash text;
  v_groups uuid[];
  v_group uuid;
  v_related integer := 0;
  v_account uuid;
  v_linked integer := 0;
begin
  select * into v_q from public.quotations_db q where q.quote_id = p_quote_id;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  -- Los borradores del cotizador no se vinculan (el wizard anónimo los sigue editando).
  if public.cot_cliente_is_wizard_draft(v_q.quote_status::text, v_q.artist_responded_at,
                                         v_q.artist_budget_amount::text, v_q.final_budget_amount::text) then
    return jsonb_build_object('found', true, 'skipped', 'draft');
  end if;

  v_email := lower(btrim(coalesce(v_q.client_email, '')));
  v_phone := public.quotation_contact_phone_key(v_q.client_whatsapp);
  v_email_hash := case when v_email = '' then null
                       else encode(sha256(convert_to('email:' || v_email, 'UTF8')), 'hex') end;
  v_phone_hash := case when v_phone is null then null
                       else encode(sha256(convert_to('phone:' || v_phone, 'UTF8')), 'hex') end;

  -- Un solo vínculo a la vez: dos envíos simultáneos del mismo contacto no
  -- crean dos grupos.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('quotation_contact_links', 0));

  select array_agg(distinct l.contact_group_id), count(*)
    into v_groups, v_related
    from public.quotation_contact_links l
   where l.quote_id <> v_q.quote_id
     and ((v_email_hash is not null and l.email_hash = v_email_hash)
       or (v_phone_hash is not null and l.phone_hash = v_phone_hash));

  select l.contact_group_id into v_group
    from public.quotation_contact_links l where l.quote_id = v_q.quote_id;

  if v_groups is not null then
    if v_group is not null then
      v_groups := v_groups || v_group;
    end if;
    -- Determinístico: gana el grupo "menor"; los demás se funden en él.
    select g into v_group from unnest(v_groups) as g order by g::text limit 1;
    update public.quotation_contact_links l
       set contact_group_id = v_group, updated_at = pg_catalog.now()
     where l.contact_group_id = any (v_groups)
       and l.contact_group_id <> v_group;
  elsif v_group is null then
    v_group := gen_random_uuid();
  end if;

  insert into public.quotation_contact_links (quote_id, contact_group_id, email_hash, phone_hash)
  values (v_q.quote_id, v_group, v_email_hash, v_phone_hash)
  on conflict (quote_id) do update
     set contact_group_id = excluded.contact_group_id,
         email_hash = excluded.email_hash,
         phone_hash = excluded.phone_hash,
         updated_at = pg_catalog.now();

  -- Cuenta de cliente verificada dueña del email (nunca por teléfono).
  if v_email <> '' then
    select u.id into v_account
      from auth.users u
      join public.clients_db c on c.user_id = u.id
     where lower(btrim(u.email)) = v_email
       and u.email_confirmed_at is not null
       and u.deleted_at is null
       and coalesce(u.is_anonymous, false) = false
       and coalesce(u.raw_app_meta_data->>'qa_unverified_email', 'false') <> 'true'
       and coalesce(u.raw_user_meta_data->>'qa_unverified_email', 'false') <> 'true'
     order by u.created_at
     limit 1;

    if v_account is not null then
      update public.quotations_db q
         set client_user_id = v_account
       where q.client_user_id is null
         and lower(btrim(coalesce(q.client_email, ''))) = v_email
         and not public.cot_cliente_is_wizard_draft(q.quote_status::text, q.artist_responded_at,
                                                    q.artist_budget_amount::text, q.final_budget_amount::text);
      get diagnostics v_linked = row_count;
    end if;
  end if;

  return jsonb_build_object(
    'found', true,
    'contact_group_id', v_group,
    'related', coalesce(v_related, 0),
    'account_linked', v_linked
  );
end;
$$;

revoke all on function public.link_quotation_contact(text) from public;
revoke all on function public.link_quotation_contact(text) from anon, authenticated;
grant execute on function public.link_quotation_contact(text) to service_role;

-- ---------------------------------------------------------------------------
-- Lectura para el detalle del artista: otras cotizaciones del mismo contacto.
-- El artista dueño solo ve las SUYAS; soporte ve todas las del grupo.
-- ---------------------------------------------------------------------------
create or replace function public.quotation_same_contact(p_quote_id text)
returns table (
  quote_id text,
  short_code text,
  quote_status text,
  created_at timestamptz,
  tattoo_idea_description text,
  same_email boolean,
  same_phone boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select q.quote_id::text,
         q.short_code,
         q.quote_status::text,
         q.created_at,
         left(coalesce(q.tattoo_idea_description, ''), 160),
         (me.email_hash is not null and l.email_hash = me.email_hash),
         (me.phone_hash is not null and l.phone_hash = me.phone_hash)
    from public.quotations_db base
    join public.quotation_contact_links me on me.quote_id = base.quote_id
    join public.quotation_contact_links l
      on l.contact_group_id = me.contact_group_id and l.quote_id <> me.quote_id
    join public.quotations_db q on q.quote_id = l.quote_id
   where base.quote_id = p_quote_id
     and (select auth.uid()) is not null
     and (
       (base.artist_id = (select auth.uid()) and q.artist_id = base.artist_id)
       or public.is_support_user()
     )
   order by q.created_at desc
   limit 50;
$$;

revoke all on function public.quotation_same_contact(text) from public;
revoke all on function public.quotation_same_contact(text) from anon;
grant execute on function public.quotation_same_contact(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill: agrupa las cotizaciones ya enviadas (en orden de alta). No vincula
-- cuentas acá: eso ya lo hizo el backfill de 20261115140000 y lo repite el
-- claim en cada inicio de sesión.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_email text;
  v_phone text;
  v_email_hash text;
  v_phone_hash text;
  v_groups uuid[];
  v_group uuid;
begin
  for r in
    select q.quote_id, q.client_email, q.client_whatsapp
      from public.quotations_db q
     where q.quote_id is not null
       and not public.cot_cliente_is_wizard_draft(q.quote_status::text, q.artist_responded_at,
                                                  q.artist_budget_amount::text, q.final_budget_amount::text)
       and not exists (select 1 from public.quotation_contact_links l where l.quote_id = q.quote_id)
     order by q.created_at, q.id
  loop
    v_email := lower(btrim(coalesce(r.client_email, '')));
    v_phone := public.quotation_contact_phone_key(r.client_whatsapp);
    v_email_hash := case when v_email = '' then null
                         else encode(sha256(convert_to('email:' || v_email, 'UTF8')), 'hex') end;
    v_phone_hash := case when v_phone is null then null
                         else encode(sha256(convert_to('phone:' || v_phone, 'UTF8')), 'hex') end;

    select array_agg(distinct l.contact_group_id) into v_groups
      from public.quotation_contact_links l
     where (v_email_hash is not null and l.email_hash = v_email_hash)
        or (v_phone_hash is not null and l.phone_hash = v_phone_hash);

    if v_groups is not null then
      select g into v_group from unnest(v_groups) as g order by g::text limit 1;
      update public.quotation_contact_links l
         set contact_group_id = v_group
       where l.contact_group_id = any (v_groups) and l.contact_group_id <> v_group;
    else
      v_group := gen_random_uuid();
    end if;

    insert into public.quotation_contact_links (quote_id, contact_group_id, email_hash, phone_hash)
    values (r.quote_id, v_group, v_email_hash, v_phone_hash)
    on conflict (quote_id) do nothing;
  end loop;
end $$;

commit;
