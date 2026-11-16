-- Cotizaciones · el vínculo con el cliente y el origen no los cambia el usuario
-- final (ronda 2 · integración · 16 nov 2026 · hallazgos SEG-04 y SEG-01).
--
-- Problema. public.fn_quotations_client_column_guard (20261115130000) dejaba
-- pasar CUALQUIER cambio del artista dueño de la cotización. Por REST directo,
-- con su propia sesión, el artista podía:
--   a) reescribir client_user_id (a null o a su propio uid). Las guardas de la
--      ronda 2 dependen de ese vínculo: sin cliente con cuenta se apagan el
--      bloqueo del acuerdo aprobado (20261116140000) y la confirmación de
--      sesiones (20261116150000); con su propio uid, el artista pasaba a ser
--      también "el cliente" y aprobaba sus propias enmiendas o confirmaba sus
--      propias sesiones. Después volvía a poner al cliente real.
--   b) marcar una cotización recibida como manual (source / quotation_medium):
--      el contacto del cliente se entrega sin verificación en las cotizaciones
--      manuales (lib/cot-detalle.js contactAccess), también en las rechazadas.
--
-- Arreglo. La función se reemplaza con dos reglas que valen para todo usuario
-- final (roles anon / authenticated), artista dueño incluido:
--   1. client_user_id solo cambia de NULL al uid del que escribe, y nunca si el
--      que escribe es el artista de esa cotización (un cliente que vincula su
--      cotización de invitado sigue pasando).
--   2. source y quotation_medium no cambian.
-- El resto queda igual: el artista dueño edita lo demás, el cliente solo
-- vincula u oculta, soporte y el servidor no pasan por estas reglas.
--
-- No se ven afectados: la cotización manual (RPC create_manual_quotation,
-- security definer: fija client_user_id y el origen en el INSERT), el intake y
-- los vínculos del servidor (service_role), soporte (is_support_user) ni
-- postgres. Ningún flujo del navegador cambia estas columnas en un UPDATE.
--
-- El trigger trg_a_quotations_client_column_guard ya existe y no se toca.
-- Idempotente. Reversa:
-- supabase/rollbacks/20261116220000_quotations_guardas_vinculo_y_origen.down.sql

begin;

create or replace function public.fn_quotations_client_column_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_changed text[];
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if public.is_support_user() then
    return new;
  end if;

  -- Reglas para todo usuario final, artista dueño incluido.
  -- 1. El vínculo con el cliente: solo NULL → la propia cuenta, y nunca la del
  --    artista de la cotización.
  if new.client_user_id is distinct from old.client_user_id
     and not (
       old.client_user_id is null
       and v_uid is not null
       and new.client_user_id = v_uid
       and old.artist_id is distinct from v_uid
     ) then
    raise exception 'Solo puedes vincular la cotización a tu propia cuenta de cliente.'
      using errcode = '42501';
  end if;

  -- 2. El origen de la cotización (recibida, manual, pre-cotizador…).
  if new.source is distinct from old.source
     or new.quotation_medium is distinct from old.quotation_medium then
    raise exception 'El origen de la cotización no se puede modificar.'
      using errcode = '42501';
  end if;

  -- El artista dueño edita el resto de su cotización.
  if v_uid is not null and old.artist_id is not null and old.artist_id = v_uid then
    return new;
  end if;

  -- El cliente solo puede vincular la cotización a su cuenta u ocultarla.
  select array_agg(n.key order by n.key)
    into v_changed
    from jsonb_each(to_jsonb(new)) as n
   where n.value is distinct from (to_jsonb(old) -> n.key)
     and n.key not in ('client_user_id', 'client_deleted_at', 'updated_at');

  if v_changed is not null then
    raise exception 'No puedes modificar estos datos de la cotización: %', array_to_string(v_changed, ', ')
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.fn_quotations_client_column_guard() is
  'BEFORE UPDATE de quotations_db (trg_a_quotations_client_column_guard). Para anon/authenticated que no son soporte: client_user_id solo pasa de NULL al uid del que escribe (nunca el del artista de la cotización) y source / quotation_medium no cambian, tampoco para el artista dueño. El cliente solo vincula u oculta la cotización.';

commit;
