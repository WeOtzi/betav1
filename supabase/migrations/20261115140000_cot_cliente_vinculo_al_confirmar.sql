-- ============================================================================
-- Cotizaciones del cliente · vínculo de las cotizaciones de invitado al
-- confirmar el email (beta cerrada · frente cot-cliente · CC-02 / ACC-12).
--
-- Hoy handle_new_user (AFTER INSERT en auth.users) vincula por email solo si el
-- usuario YA llega confirmado (OAuth o alta por admin). Con email y contraseña
-- el email se confirma después (en este u otro dispositivo) y sync_email_confirmed
-- solo marca artists_db.email_confirmed: las cotizaciones quedan huérfanas y
-- clients_db.email_verified queda en false.
--
-- Esta migración NO reemplaza sync_email_confirmed ni handle_new_user (otros
-- frentes las tocan): agrega un trigger propio AFTER UPDATE OF email_confirmed_at
-- que, cuando el email pasa de no confirmado a confirmado:
--   1) marca clients_db.email_verified = true;
--   2) vincula las cotizaciones sin dueño con ese email (sin distinguir
--      mayúsculas), salvo los borradores del cotizador (in_progress sin
--      respuesta del artista), que el wizard anónimo sigue editando.
-- Las cuentas de QA (qa_unverified_email) nunca vinculan por email.
--
-- Además, un backfill idempotente para las cuentas ya confirmadas que tienen
-- cotizaciones de invitado sin vincular. El endpoint POST /api/client/quotations/claim
-- (lib/routes/cot-cliente.js) cubre el mismo caso en cada inicio de sesión.
--
-- Idempotente. Reversa: supabase/rollbacks/20261115140000_cot_cliente_vinculo_al_confirmar.down.sql
-- ============================================================================

begin;

-- Criterio único de "borrador del cotizador" (igual que
-- QuotationsViewModel.isClientWizardDraft y lib/cot-cliente.js isWizardDraft).
create or replace function public.cot_cliente_is_wizard_draft(
  p_status text, p_responded_at timestamptz, p_artist_budget text, p_final_budget text
) returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_status, '') = 'in_progress'
     and p_responded_at is null
     and nullif(btrim(coalesce(p_artist_budget, '')), '') is null
     and nullif(btrim(coalesce(p_final_budget, '')), '') is null;
$$;

create or replace function public.link_client_quotations_on_email_confirm()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(new.email, '')));
  v_qa boolean := coalesce(new.raw_app_meta_data->>'qa_unverified_email', 'false') = 'true'
               or coalesce(new.raw_user_meta_data->>'qa_unverified_email', 'false') = 'true';
begin
  -- Solo en la transición no confirmado → confirmado.
  if new.email_confirmed_at is null or old.email_confirmed_at is not null then
    return new;
  end if;
  if v_email = '' or v_qa then
    return new;
  end if;

  begin
    update public.clients_db
       set email_verified = true
     where user_id = new.id
       and email_verified is distinct from true;
  exception when others then
    raise warning 'link_client_quotations_on_email_confirm (clients_db): %', sqlerrm;
  end;

  begin
    update public.quotations_db q
       set client_user_id = new.id
     where q.client_user_id is null
       and lower(btrim(coalesce(q.client_email, ''))) = v_email
       and not public.cot_cliente_is_wizard_draft(q.quote_status, q.artist_responded_at, q.artist_budget_amount, q.final_budget_amount);
  exception when others then
    -- Nunca bloquear la confirmación del email por un problema del vínculo.
    raise warning 'link_client_quotations_on_email_confirm (quotations_db): %', sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.link_client_quotations_on_email_confirm() from public;
revoke all on function public.link_client_quotations_on_email_confirm() from anon, authenticated;

drop trigger if exists on_email_confirmed_link_client_quotations on auth.users;
create trigger on_email_confirmed_link_client_quotations
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.link_client_quotations_on_email_confirm();

-- ---------------------------------------------------------------------------
-- Backfill: cuentas ya confirmadas (no QA, no borradas) con cotizaciones de
-- invitado sin vincular. Si hubiera dos cuentas con el mismo email (no debería),
-- gana la más antigua.
-- ---------------------------------------------------------------------------
with cuentas as (
  select distinct on (lower(btrim(u.email)))
         u.id, lower(btrim(u.email)) as email
    from auth.users u
   where u.email is not null
     and btrim(u.email) <> ''
     and u.email_confirmed_at is not null
     and u.deleted_at is null
     and coalesce(u.is_anonymous, false) = false
     and coalesce(u.raw_app_meta_data->>'qa_unverified_email', 'false') <> 'true'
     and coalesce(u.raw_user_meta_data->>'qa_unverified_email', 'false') <> 'true'
   order by lower(btrim(u.email)), u.created_at
)
update public.quotations_db q
   set client_user_id = c.id
  from cuentas c
 where q.client_user_id is null
   and lower(btrim(coalesce(q.client_email, ''))) = c.email
   and not public.cot_cliente_is_wizard_draft(q.quote_status, q.artist_responded_at, q.artist_budget_amount, q.final_budget_amount);

update public.clients_db c
   set email_verified = true
  from auth.users u
 where u.id = c.user_id
   and u.email_confirmed_at is not null
   and coalesce(u.raw_app_meta_data->>'qa_unverified_email', 'false') <> 'true'
   and coalesce(u.raw_user_meta_data->>'qa_unverified_email', 'false') <> 'true'
   and c.email_verified is distinct from true;

commit;
