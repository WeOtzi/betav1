-- ============================================================================
-- El acuerdo necesita la aprobación del cliente cuando tiene cuenta (REQ-13 B)
-- ============================================================================
-- Hasta la 2.5.0 el artista podía usar "Confirmar acuerdo y agendar" sobre una
-- cotización respondida y dejarla "aprobada por ambas partes", con el saldo
-- acordado activo, sin que el cliente hubiera aceptado nada en la app. La
-- ronda 2 ya lo impedía si el cliente tenía cambios propuestos pendientes;
-- esta migración cierra el resto: con cliente con cuenta, responded →
-- client_approved hecho por el artista desde el navegador se rechaza.
--
-- Qué NO cambia:
--   - El cliente acepta la propuesta en la app (servidor, service_role).
--   - El artista acepta los cambios que propuso el cliente (negociacion_resolve,
--     service_role): ahí también aprobaron los dos.
--   - Cotizaciones sin cuenta de cliente vinculada (client_user_id vacío: de
--     invitado, o manuales cuyo correo no coincide con una cuenta de cliente):
--     el artista registra el acuerdo como siempre.
--   - Después de la aprobación, el artista agenda la primera sesión igual que
--     antes (la cotización ya está en client_approved: no hay cambio de estado).
--   - Soporte y service_role.
--
-- Alcance: la regla mira client_user_id, no el origen. Una cotización manual o
-- una "Nueva cita" creada con el correo de un cliente registrado nace vinculada
-- (create_manual_quotation) y también espera la aprobación del cliente.
--
-- Es la función de 20261116140000 tal cual, con una regla más dentro del bloque
-- "responded → client_approved". Va DESPUÉS de publicar el código 2.5.1: el
-- código nuevo deja de ofrecer la acción. Con la 2.5.0 sirviendo, el artista
-- recibiría "No pudimos guardar. Prueba nuevamente." sin explicación (ese
-- código no muestra el texto de la base) y con el turno apartado ya reservado.
-- Para volver atrás, al revés: primero la reversa y después el código.
-- Reversa: supabase/rollbacks/20261117100000_acuerdo_requiere_aprobacion_del_cliente.down.sql
-- ============================================================================

begin;

create or replace function public.negociacion_quotation_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_restricted boolean := current_user in ('anon', 'authenticated')
                          and not coalesce(public.is_support_user(), false);
begin
  -- El sello del acuerdo no lo escribe el usuario final.
  if v_restricted then
    new.agreement_approved_at := old.agreement_approved_at;
    new.agreement_version := old.agreement_version;
  end if;

  if new.quote_status is distinct from old.quote_status then
    -- Rechazo del cliente = cotización finalizada: el artista no la reabre.
    -- También frena a service_role: el servidor guarda la propuesta del
    -- artista con service-role (lib/repos/cot-respuesta.js) y no debe poder
    -- reabrirla en su nombre. Soporte (is_support_user) y postgres sí pueden.
    if old.quote_status = 'client_rejected'
       and current_user in ('anon', 'authenticated', 'service_role')
       and not coalesce(public.is_support_user(), false) then
      raise exception 'El cliente rechazó esta cotización y quedó finalizada. Para retomarla, el cliente tiene que iniciar una nueva.'
        using errcode = '42501';
    end if;

    -- Acuerdo aprobado con contraparte: el usuario final no lo devuelve a
    -- negociación. Si no, el artista podía pasar in_progress → pending (ahí se
    -- borra el sello), reescribir el precio, y volver a responded →
    -- client_approved para sellarlo de nuevo sin el cliente. El envío del
    -- borrador del cotizador (in_progress → pending) lo hace el servidor con
    -- service_role y un borrador nunca tiene el acuerdo sellado.
    if v_restricted
       and old.agreement_approved_at is not null
       and old.client_user_id is not null
       and new.quote_status in ('pending', 'responded') then
      raise exception 'El acuerdo ya está aprobado por ambas partes: propón el cambio y regirá cuando la otra parte lo apruebe.'
        using errcode = '42501';
    end if;

    -- Contrapropuesta del cliente pendiente: el artista no registra el acuerdo
    -- por su cuenta. Si no, el trigger de sincronización la descartaba ("La
    -- cotización cambió de estado.") y la cotización quedaba aprobada por
    -- ambas partes sin que el cliente hubiera aceptado. Primero la resuelve:
    -- la acepta, envía otra propuesta o mantiene la suya (negociacion_resolve
    -- corre con service_role y cierra la propuesta antes de tocar la
    -- cotización, así que no pasa por aquí). El cliente acepta la propuesta
    -- original por el servidor (lib/routes/cot-cliente.js), también con
    -- service_role: puede hacerlo con su contrapropuesta pendiente.
    -- IF anidados a propósito: auth.uid() y la tabla de propuestas solo se
    -- consultan cuando quien escribe es un usuario final y, la tabla, cuando
    -- es el artista de la cotización (su RLS le deja leerla).
    if v_restricted
       and old.quote_status = 'responded'
       and new.quote_status = 'client_approved' then
      if (select auth.uid()) = old.artist_id then
        if exists (
          select 1 from public.quotation_proposals p
           where p.quotation_id = new.id and p.kind = 'counter' and p.status = 'pending'
        ) then
          raise exception 'El cliente propuso cambios: acéptalos, envía otra propuesta o mantén la tuya antes de registrar el acuerdo.'
            using errcode = '42501';
        end if;
        -- REQ-13 (parte B, decisión del dueño 16 nov 2026): si el cliente tiene
        -- cuenta, el acuerdo lo aprueba él en la app. El artista ya no lo
        -- registra por su cuenta: solo así "aprobada por ambas partes" es
        -- cierto y el saldo acordado se activa con las dos aprobaciones. Las
        -- vías legítimas no pasan por aquí porque corren con service_role: el
        -- cliente acepta por el servidor (lib/routes/cot-cliente.js) y el
        -- artista acepta la contrapropuesta con negociacion_resolve. Sin cuenta
        -- vinculada (client_user_id vacío: de invitado, o manual cuyo correo no
        -- es de un cliente registrado) el artista sigue registrando el acuerdo
        -- como siempre.
        if old.client_user_id is not null then
          raise exception 'El cliente tiene cuenta en We Ötzi: el acuerdo queda aprobado cuando acepta tu propuesta en la app. Pídele que la acepte desde su panel.'
            using errcode = '42501';
        end if;
      end if;
    end if;

    if new.quote_status = 'client_approved' then
      -- Aprobada por ambas partes: acepta el cliente, o el artista acepta la
      -- contrapropuesta. Si el cliente no tiene cuenta, la registra el artista.
      new.agreement_approved_at := coalesce(new.agreement_approved_at, now());
      new.agreement_version := greatest(coalesce(new.agreement_version, 0), 1);
    elsif new.quote_status in ('pending', 'responded') then
      -- Vuelve a negociación: ya no hay acuerdo vigente.
      new.agreement_approved_at := null;
      new.agreement_version := 0;
    end if;
  end if;

  -- Acuerdo aprobado: precio, sesiones, anticipo y condiciones no se editan
  -- directo; se proponen (quotation_proposals) y rigen al aprobarlos. Solo
  -- cuando hay contraparte que pueda aprobar: si el cliente no tiene cuenta
  -- (cotización manual o de invitado), el artista edita como siempre.
  if v_restricted
     and old.agreement_approved_at is not null
     and old.client_user_id is not null
     and (
       new.final_budget_amount is distinct from old.final_budget_amount
       or new.final_budget_currency is distinct from old.final_budget_currency
       or new.final_sessions is distinct from old.final_sessions
       or new.final_comment is distinct from old.final_comment
       or new.artist_deposit_pct is distinct from old.artist_deposit_pct
       or new.artist_deposit_amount is distinct from old.artist_deposit_amount
     ) then
    raise exception 'El acuerdo ya está aprobado por ambas partes: propón el cambio y regirá cuando la otra parte lo apruebe.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.negociacion_quotation_guard() from public, anon, authenticated;

commit;
