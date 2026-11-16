-- ============================================================================
-- Notificaciones push y avisos en la app (ronda 2 · frente push · P24)
--
-- 1. push_subscriptions: una fila por navegador suscripto a Web Push (endpoint
--    del servicio push + claves p256dh/auth). El servidor (service_role) la
--    escribe desde POST /api/push/subscribe después de validar el endpoint; el
--    dueño puede ver sus dispositivos (sin las claves) y borrarlos.
-- 2. user_notifications: avisos del usuario (título, texto, destino). El
--    servidor inserta uno por cada aviso que también sale por correo o por
--    chat; la app abierta lo recibe por Realtime (toast + sonido) y el índice
--    único (user_id, dedupe_key) evita repetir el mismo aviso (y su push).
--    El dueño solo puede leerlos y marcarlos como leídos (read_at).
-- 3. user_notifications entra en la publicación supabase_realtime.
-- 4. push_recipient_user_id(rol, email): a quién avisar cuando el evento solo
--    trae un email. Resuelve contra el email verificado de Auth (SEG-05).
--
-- Idempotente. Reversa: supabase/rollbacks/20261116170000_push_notifications.down.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Suscripciones Web Push
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_https
    check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  -- base64url sin relleno: punto P-256 sin comprimir (65 bytes) y secreto de 16 bytes.
  constraint push_subscriptions_keys_shape
    check (p256dh ~ '^[A-Za-z0-9_-]{87}$' and auth ~ '^[A-Za-z0-9_-]{22}$'),
  constraint push_subscriptions_user_agent_len
    check (user_agent is null or char_length(user_agent) <= 400),
  constraint push_subscriptions_failures_nonneg check (failure_count >= 0)
);

comment on table public.push_subscriptions is
  'Suscripciones Web Push por navegador. Escribe el servidor (service_role); el dueño lee (sin claves) y borra.';

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from anon, authenticated;
-- Las claves (p256dh, auth) no se exponen a la API del navegador.
grant select (id, user_id, endpoint, user_agent, created_at, updated_at, last_success_at)
  on table public.push_subscriptions to authenticated;
grant delete on table public.push_subscriptions to authenticated;
grant all on table public.push_subscriptions to service_role;

drop policy if exists push_subscriptions_owner_select on public.push_subscriptions;
create policy push_subscriptions_owner_select on public.push_subscriptions
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists push_subscriptions_owner_delete on public.push_subscriptions;
create policy push_subscriptions_owner_delete on public.push_subscriptions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2 · Avisos del usuario (in-app en tiempo real + dedupe del push)
-- ---------------------------------------------------------------------------
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'client',
  kind text,
  event_id text,
  title text not null,
  body text,
  url text,
  tag text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint user_notifications_role_check check (role in ('artist', 'client', 'studio')),
  constraint user_notifications_title_len check (char_length(title) between 1 and 160),
  constraint user_notifications_body_len check (body is null or char_length(body) <= 400),
  -- Solo rutas internas de la app (nunca un host externo ni //host).
  constraint user_notifications_url_internal
    check (url is null or (char_length(url) <= 600 and url ~ '^/([^/\\]|$)')),
  constraint user_notifications_kind_len check (kind is null or char_length(kind) <= 40),
  constraint user_notifications_event_len check (event_id is null or char_length(event_id) <= 100),
  constraint user_notifications_tag_len check (tag is null or char_length(tag) <= 120),
  constraint user_notifications_dedupe_len check (dedupe_key is null or char_length(dedupe_key) <= 200)
);

comment on table public.user_notifications is
  'Avisos del usuario (push / in-app). Inserta el servidor (service_role); el dueño lee y marca read_at.';

create unique index if not exists user_notifications_dedupe_idx
  on public.user_notifications (user_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists user_notifications_recent_idx
  on public.user_notifications (user_id, created_at desc);

alter table public.user_notifications enable row level security;

revoke all on table public.user_notifications from anon, authenticated;
grant select on table public.user_notifications to authenticated;
grant update (read_at) on table public.user_notifications to authenticated;
grant all on table public.user_notifications to service_role;

drop policy if exists user_notifications_owner_select on public.user_notifications;
create policy user_notifications_owner_select on public.user_notifications
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_notifications_owner_update on public.user_notifications;
create policy user_notifications_owner_update on public.user_notifications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 3 · Realtime: la app abierta recibe el aviso al instante (RLS de dueño)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'user_notifications'
     ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4 · Destinatario de un aviso por email (SEG-05)
-- ---------------------------------------------------------------------------
-- Cuando el evento no trae el user_id del destinatario, el servidor lo busca
-- por email. La búsqueda va contra el email VERIFICADO de auth.users y exige
-- que la cuenta tenga fila en la tabla de su rol. No se usa la columna email
-- de clients_db / artists_db / studios: la edita el propio usuario y con poner
-- el correo de otra persona recibía sus avisos (artista, cotización, fechas y
-- totales). Mismo criterio que link_quotation_contact (20261116110200).
-- Solo service_role la ejecuta (lib/repos/push.js → findUserIdByEmail).
create or replace function public.push_recipient_user_id(p_role text, p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from auth.users u
   where pg_catalog.btrim(coalesce(p_email, '')) <> ''
     and pg_catalog.lower(pg_catalog.btrim(u.email)) = pg_catalog.lower(pg_catalog.btrim(p_email))
     and u.email_confirmed_at is not null
     and u.deleted_at is null
     and coalesce(u.is_anonymous, false) = false
     and coalesce(u.raw_app_meta_data->>'qa_unverified_email', 'false') <> 'true'
     and coalesce(u.raw_user_meta_data->>'qa_unverified_email', 'false') <> 'true'
     and case p_role
           when 'client' then exists (select 1 from public.clients_db c where c.user_id = u.id)
           when 'artist' then exists (select 1 from public.artists_db a where a.user_id = u.id)
           when 'studio' then exists (select 1 from public.studios s where s.user_id = u.id)
           else false
         end
   order by u.created_at
   limit 1;
$$;

revoke all on function public.push_recipient_user_id(text, text) from public, anon, authenticated;
grant execute on function public.push_recipient_user_id(text, text) to service_role;

commit;
