-- Inbox · la vista chat_threads deja de entregar el email del cliente
-- (ronda 2 · integración · 16 nov 2026 · hallazgo SEG-01).
--
-- P20 / P23: el artista ve el contacto del cliente solo con el perfil
-- verificado y nunca en una cotización rechazada (lib/cot-detalle.js). La vista
-- chat_threads (security_invoker) incluía q.client_email y el inbox la lee con
-- select('*'): el email de cada cliente con un hilo de chat viajaba al
-- navegador del artista aunque no estuviera verificado. Ningún código usa esa
-- columna de la vista (los hilos se pintan con client_full_name).
--
-- CREATE OR REPLACE VIEW no puede quitar columnas: se borra y se vuelve a
-- crear, igual que la definición vigente (20261115170000) menos client_email.
-- Nada depende de la vista (ni otras vistas ni publicaciones de Realtime).
-- Los privilegios se dan explícitos: lectura para authenticated (la RLS de
-- quotations_db y chat_messages sigue filtrando por security_invoker) y
-- service_role; anon sin acceso, como hasta ahora.
--
-- Idempotente. Reversa:
-- supabase/rollbacks/20261116220100_chat_threads_sin_client_email.down.sql

begin;

drop view if exists public.chat_threads;

create view public.chat_threads
with (security_invoker = on) as
select q.quote_id,
    q.id as quotation_id_int,
    q.artist_id,
    q.artist_name,
    q.artist_username,
    q.client_user_id,
    q.client_full_name,
    q.quote_status,
    q.tattoo_body_part,
    q.tattoo_style,
    q.tattoo_size,
    q.final_budget_amount,
    q.final_budget_currency,
    q.source,
    lm.message as last_message,
    lm.sender_type as last_message_sender,
    lm.created_at as last_message_at,
    coalesce(uc.unread_for_artist, 0::bigint) as unread_for_artist,
    coalesce(uc.unread_for_client, 0::bigint) as unread_for_client
from public.quotations_db q
join lateral (
    select coalesce(
             nullif(btrim(m.message), ''),
             case when m.message_kind = 'image' then 'Imagen adjunta'
                  else coalesce(m.attachment_name, 'Archivo adjunto') end
           ) as message,
           m.sender_type,
           m.created_at
    from public.chat_messages m
    where m.quotation_id = q.quote_id::text
    order by m.created_at desc
    limit 1
) lm on true
left join lateral (
    select count(*) filter (where m.sender_type = 'client' and m.is_read is not true) as unread_for_artist,
           count(*) filter (where m.sender_type = 'artist' and m.is_read is not true) as unread_for_client
    from public.chat_messages m
    where m.quotation_id = q.quote_id::text
) uc on true
where q.client_user_id is not null;

comment on view public.chat_threads is
  'Hilos de chat de cotización (inbox del artista y chats del cliente). security_invoker: aplica la RLS de quotations_db y chat_messages del que consulta. Sin datos de contacto del cliente: el contacto se entrega solo por GET /api/cot-detalle/quotations/:id/info.';

revoke all on table public.chat_threads from public, anon, authenticated;
grant select on table public.chat_threads to authenticated;
grant select on table public.chat_threads to service_role;

-- La API (PostgREST) tiene que volver a leer las columnas de la vista.
notify pgrst, 'reload schema';

commit;
