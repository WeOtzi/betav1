-- Ronda 2 · frente cot-respuesta (16 nov 2026).
--
-- P4. La respuesta del artista ("Aceptar y enviar presupuesto") deja de tener
-- la disponibilidad como texto libre: ahora ofrece varias fechas desde un
-- calendario conectado a su agenda real. Se guardan en la propuesta:
--
--   quotations_db.offered_slots     jsonb, arreglo de hasta 12 ítems
--       { "kind": "slot",  "start": ISO, "end": ISO, "label": "...", "tz": "..." }
--       { "kind": "range", "start": ISO, "end": ISO, "from": "AAAA-MM-DD",
--         "to": "AAAA-MM-DD", "label": "...", "tz": "..." }
--     "slot" es un turno con horario; "range" un rango de días (horario a
--     coordinar). start/end son instantes UTC; label ya viene en la zona
--     horaria del artista. Lo escribe SOLO el servidor
--     (POST /api/cot-respuesta/quotations/:id/proposal), que rechaza lo que
--     choca con eventos confirmados de la agenda.
--   quotations_db.proposal_message  mensaje para el cliente ya resuelto (las
--     variables {{cliente}}, {{presupuesto}}… se reemplazan antes de guardar).
--
-- artist_availability (texto) se sigue escribiendo con el resumen legible de
-- las fechas, así el panel del cliente y los correos existentes no cambian.
--
-- Columnas NULLABLE con default: hay RPC que insertan quotations_db desde un
-- registro (jsonb_populate_record) y un NOT NULL nuevo las rompería.
-- El trigger fn_quotations_client_column_guard ya impide que el cliente las
-- modifique (compara todas las columnas de la fila).
--
-- P4. Respuestas rápidas del artista: tabla artist_message_templates,
-- compartida con el frente "inbox" (kind = 'chat'); este frente usa
-- kind = 'quote'. Si la tabla ya existe (migración del inbox), el
-- "create table if not exists" no la toca y las policies de aquí solo usan
-- user_id. Los defaults del producto viven en el código, no en la tabla.
--
-- Aditiva e idempotente. Reversa:
-- supabase/rollbacks/20261116120000_cot_respuesta_propuesta.down.sql

begin;

-- ------------------------------------------------------------------ propuesta
alter table public.quotations_db
  add column if not exists offered_slots jsonb default '[]'::jsonb,
  add column if not exists proposal_message text;

alter table public.quotations_db
  drop constraint if exists quotations_db_offered_slots_check;
alter table public.quotations_db
  add constraint quotations_db_offered_slots_check
  check (
    offered_slots is null
    or (case when jsonb_typeof(offered_slots) = 'array'
             then jsonb_array_length(offered_slots) <= 12
             else false end)
  );

alter table public.quotations_db
  drop constraint if exists quotations_db_proposal_message_check;
alter table public.quotations_db
  add constraint quotations_db_proposal_message_check
  check (proposal_message is null or char_length(proposal_message) <= 2000);

comment on column public.quotations_db.offered_slots is
  'Fechas ofrecidas por el artista en su propuesta: arreglo de { kind slot|range, start, end, label, tz[, from, to] }. Lo escribe el servidor tras validar contra la agenda.';
comment on column public.quotations_db.proposal_message is
  'Mensaje del artista que acompaña la propuesta, con las variables ya resueltas.';

-- ---------------------------------------------------------- respuestas rápidas
create table if not exists public.artist_message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('quote', 'chat')),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.artist_message_templates is
  'Respuestas rápidas guardadas por el artista. kind = quote (propuesta de cotización) | chat (inbox).';

create index if not exists artist_message_templates_user_kind_idx
  on public.artist_message_templates (user_id, kind, sort);

alter table public.artist_message_templates enable row level security;

drop policy if exists artist_message_templates_owner_select on public.artist_message_templates;
create policy artist_message_templates_owner_select on public.artist_message_templates
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists artist_message_templates_owner_insert on public.artist_message_templates;
create policy artist_message_templates_owner_insert on public.artist_message_templates
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists artist_message_templates_owner_update on public.artist_message_templates;
create policy artist_message_templates_owner_update on public.artist_message_templates
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists artist_message_templates_owner_delete on public.artist_message_templates;
create policy artist_message_templates_owner_delete on public.artist_message_templates
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Los privilegios por defecto de Supabase dan ALL (incluido TRUNCATE, que
-- omite la RLS) a anon y authenticated en cada tabla nueva: se dejan solo
-- los cuatro que usa la app.
revoke all on public.artist_message_templates from public, anon, authenticated;
grant select, insert, update, delete on public.artist_message_templates to authenticated;
grant all on public.artist_message_templates to service_role;

commit;
