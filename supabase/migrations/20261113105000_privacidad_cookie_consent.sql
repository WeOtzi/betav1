-- Ronda 3c · Grupo "privacidad": consentimiento de cookies.
--
-- Qué agrega (solo cambios aditivos e idempotentes):
--   1. public.cookie_consent_log: historial de decisiones de cookies de usuarios
--      con sesión (versión, categorías, origen, GPC, fecha). Sirve para demostrar
--      el consentimiento; NO guarda IP ni user agent.
--   2. public.record_cookie_consent(p_user_id, p_consent): security definer,
--      ejecutable SOLO por service_role (lo llama POST /api/privacy/cookie-consent
--      después de verificar el JWT del usuario). Guarda la decisión vigente en
--      user_preferences.privacy.cookie_consent (merge, sin pisar otras claves) y
--      agrega la fila al historial.
--
-- La configuración del banner vive en app_settings.setting_key =
-- 'cookie_consent_config' (fila creada por el backoffice; sin cambios de esquema).
-- Reversa: supabase/rollbacks/20261113105000_privacidad_cookie_consent.down.sql

create table if not exists public.cookie_consent_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  consent_version text not null check (consent_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  categories jsonb not null default '{}'::jsonb,
  source text not null default 'banner' check (source in ('banner', 'settings', 'gpc')),
  gpc boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_cookie_consent_log_user_created
  on public.cookie_consent_log (user_id, created_at desc);

alter table public.cookie_consent_log enable row level security;

-- El dueño ve su historial; soporte puede leerlo para responder pedidos.
-- Sin políticas de escritura: solo service_role (vía la RPC) inserta.
drop policy if exists cookie_consent_log_owner_read on public.cookie_consent_log;
create policy cookie_consent_log_owner_read on public.cookie_consent_log
  for select using ((select auth.uid()) = user_id);

drop policy if exists cookie_consent_log_support_read on public.cookie_consent_log;
create policy cookie_consent_log_support_read on public.cookie_consent_log
  for select using (public.is_support_user());

revoke insert, update, delete on public.cookie_consent_log from anon, authenticated;

create or replace function public.record_cookie_consent(p_user_id uuid, p_consent jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version text := p_consent ->> 'version';
  v_source text := coalesce(p_consent ->> 'source', 'banner');
  v_categories jsonb := coalesce(p_consent -> 'categories', '{}'::jsonb);
  v_clean jsonb;
begin
  if p_user_id is null then
    raise exception 'record_cookie_consent: falta el usuario' using errcode = '22023';
  end if;
  if v_version is null or v_version !~ '^[A-Za-z0-9._-]{1,32}$' then
    raise exception 'record_cookie_consent: versión inválida' using errcode = '22023';
  end if;
  if v_source not in ('banner', 'settings', 'gpc') then
    v_source := 'banner';
  end if;

  -- Solo categorías conocidas y booleanas; las necesarias siempre en true.
  v_categories := jsonb_build_object(
    'necessary', true,
    'analytics', coalesce(jsonb_typeof(v_categories -> 'analytics') = 'boolean' and (v_categories ->> 'analytics')::boolean, false),
    'marketing', coalesce(jsonb_typeof(v_categories -> 'marketing') = 'boolean' and (v_categories ->> 'marketing')::boolean, false)
  );

  v_clean := jsonb_build_object(
    'version', v_version,
    'categories', v_categories,
    'source', v_source,
    'gpc', coalesce(jsonb_typeof(p_consent -> 'gpc') = 'boolean' and (p_consent ->> 'gpc')::boolean, false),
    'decided_at', now()
  );

  insert into public.user_preferences (user_id, privacy)
  values (p_user_id, jsonb_build_object('cookie_consent', v_clean))
  on conflict (user_id) do update
    set privacy = coalesce(public.user_preferences.privacy, '{}'::jsonb)
                  || jsonb_build_object('cookie_consent', v_clean);

  insert into public.cookie_consent_log (user_id, consent_version, categories, source, gpc)
  values (p_user_id, v_version, v_categories, v_source, coalesce(jsonb_typeof(p_consent -> 'gpc') = 'boolean' and (p_consent ->> 'gpc')::boolean, false));
end;
$$;

revoke all on function public.record_cookie_consent(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_cookie_consent(uuid, jsonb) to service_role;

comment on table public.cookie_consent_log is
  'Historial de decisiones de cookies (privacidad, ronda 3c). Sin IP. Escribe solo record_cookie_consent (service_role).';
comment on function public.record_cookie_consent(uuid, jsonb) is
  'Guarda el consentimiento de cookies vigente en user_preferences.privacy.cookie_consent y lo agrega a cookie_consent_log. Solo service_role.';
