-- Ronda 2 · Inbox [P9] · Mensajes rápidos (16 nov 2026).
--
-- Plantillas guardadas por usuario que se insertan con un toque en el Inbox.
--
--   · public.artist_message_templates — tabla COMPARTIDA con el frente
--     "cot-respuesta" (respuestas de cotización, kind = 'quote'). El Inbox usa
--     kind = 'chat'. Columnas acordadas: user_id, kind, title, body, sort
--     (+ id, created_at, updated_at). Se crea con "create table if not exists":
--     el frente que llegue primero la crea y el otro la reutiliza. Las reglas
--     de este archivo (límites de texto y tope de cantidad) solo aplican a las
--     filas kind = 'chat'.
--   · public.client_message_templates — lo mismo para el Inbox del cliente
--     (/client/chats), sin kind.
--
-- RLS de dueño en las dos: cada usuario ve y edita solo sus plantillas.
-- Idempotente. Reversa: supabase/rollbacks/20261116160100_inbox_mensajes_rapidos.down.sql

begin;

-- ---------------------------------------------------------------- artista
create table if not exists public.artist_message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('quote', 'chat')),
  title text not null,
  body text not null,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mismo nombre que en 20261116120000 (cot-respuesta): si esa migración ya
-- corrió, esto no crea un segundo índice idéntico.
create index if not exists artist_message_templates_user_kind_idx
  on public.artist_message_templates (user_id, kind, sort);

-- Límites del Inbox: solo filas kind = 'chat' (no condiciona las de 'quote').
alter table public.artist_message_templates drop constraint if exists artist_message_templates_chat_limits;
alter table public.artist_message_templates
  add constraint artist_message_templates_chat_limits
  check (
    kind <> 'chat'
    or (
      char_length(btrim(title)) between 1 and 60
      and char_length(title) <= 80
      and char_length(btrim(body)) between 1 and 1000
      and char_length(body) <= 1200
    )
  );

alter table public.artist_message_templates enable row level security;

drop policy if exists artist_message_templates_owner_select on public.artist_message_templates;
create policy artist_message_templates_owner_select
  on public.artist_message_templates for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists artist_message_templates_owner_insert on public.artist_message_templates;
create policy artist_message_templates_owner_insert
  on public.artist_message_templates for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists artist_message_templates_owner_update on public.artist_message_templates;
create policy artist_message_templates_owner_update
  on public.artist_message_templates for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists artist_message_templates_owner_delete on public.artist_message_templates;
create policy artist_message_templates_owner_delete
  on public.artist_message_templates for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.artist_message_templates from anon;
grant select, insert, update, delete on table public.artist_message_templates to authenticated;

drop trigger if exists trg_artist_message_templates_updated_at on public.artist_message_templates;
create trigger trg_artist_message_templates_updated_at
  before update on public.artist_message_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- cliente
create table if not exists public.client_message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_message_templates_limits check (
    char_length(btrim(title)) between 1 and 60
    and char_length(title) <= 80
    and char_length(btrim(body)) between 1 and 1000
    and char_length(body) <= 1200
  )
);

create index if not exists idx_client_message_templates_owner
  on public.client_message_templates (user_id, sort);

alter table public.client_message_templates enable row level security;

drop policy if exists client_message_templates_owner_select on public.client_message_templates;
create policy client_message_templates_owner_select
  on public.client_message_templates for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists client_message_templates_owner_insert on public.client_message_templates;
create policy client_message_templates_owner_insert
  on public.client_message_templates for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists client_message_templates_owner_update on public.client_message_templates;
create policy client_message_templates_owner_update
  on public.client_message_templates for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists client_message_templates_owner_delete on public.client_message_templates;
create policy client_message_templates_owner_delete
  on public.client_message_templates for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.client_message_templates from anon;
grant select, insert, update, delete on table public.client_message_templates to authenticated;

drop trigger if exists trg_client_message_templates_updated_at on public.client_message_templates;
create trigger trg_client_message_templates_updated_at
  before update on public.client_message_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- tope
-- Hasta 30 mensajes rápidos de chat por usuario (la interfaz avisa antes).
-- En artist_message_templates solo cuenta y limita las filas kind = 'chat'.
create or replace function public.inbox_quick_replies_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if tg_table_name = 'artist_message_templates' then
    if new.kind is distinct from 'chat' then
      return new;
    end if;
    select count(*) into v_count
    from public.artist_message_templates t
    where t.user_id = new.user_id and t.kind = 'chat';
  else
    select count(*) into v_count
    from public.client_message_templates t
    where t.user_id = new.user_id;
  end if;
  if v_count >= 30 then
    raise exception 'quick_replies_limit: máximo 30 mensajes rápidos' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.inbox_quick_replies_limit() from public, anon, authenticated;

drop trigger if exists trg_artist_message_templates_chat_limit on public.artist_message_templates;
create trigger trg_artist_message_templates_chat_limit
  before insert on public.artist_message_templates
  for each row execute function public.inbox_quick_replies_limit();

drop trigger if exists trg_client_message_templates_limit on public.client_message_templates;
create trigger trg_client_message_templates_limit
  before insert on public.client_message_templates
  for each row execute function public.inbox_quick_replies_limit();

commit;
