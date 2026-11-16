-- ===========================================================================
-- Enlaces públicos de cotización (ronda 2 · frente cot-detalle · [P30])
-- ---------------------------------------------------------------------------
-- El artista comparte una cotización (manual o recibida) con un enlace
-- /cotizacion/<token> que se abre sin cuenta e invita a registrarse para
-- chatear, habilitar soporte y responder la propuesta.
--
-- 1. public.quotation_share_links: un enlace por fila. El token (32 bytes
--    aleatorios, base64url) viaja SOLO en el enlace; aquí se guarda su SHA-256
--    en hex (igual que studio_invite_links / studio_claim_links). Tiene
--    vencimiento obligatorio (máx. 366 días), revocación, contador de vistas
--    y quién vinculó la cotización a su cuenta desde el enlace.
--    Sin FK a artists_db(user_id) (misma razón que studio_invite_link_uses):
--    el servidor compara artist_id con el de la cotización en cada lectura.
-- 2. RLS habilitada SIN políticas: anon y authenticated no leen ni escriben.
--    Todo pasa por el servidor (lib/routes/cot-detalle.js, service_role), que
--    devuelve solo lo que el cliente debe ver (propuesta, desglose, términos,
--    artista) y nunca datos de salud ni de contacto.
-- 3. public.touch_quotation_share_link(text): suma una vista de forma atómica.
--    Solo service_role.
--
-- Aditiva e idempotente. Reversa:
--   supabase/rollbacks/20261116130000_quotation_share_links.down.sql
-- ===========================================================================

begin;

create table if not exists public.quotation_share_links (
  id uuid primary key default gen_random_uuid(),
  quotation_id integer not null references public.quotations_db(id) on delete cascade,
  quote_id text not null,
  artist_id uuid not null,
  token_hash text not null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  claimed_by uuid,
  claimed_at timestamptz,
  constraint quotation_share_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint quotation_share_links_quote_id_len check (char_length(quote_id) between 3 and 64),
  constraint quotation_share_links_expiry_window
    check (expires_at > created_at and expires_at <= created_at + interval '366 days'),
  constraint quotation_share_links_view_count_range check (view_count >= 0)
);

create unique index if not exists quotation_share_links_token_hash_key
  on public.quotation_share_links (token_hash);
create index if not exists quotation_share_links_quotation_idx
  on public.quotation_share_links (quotation_id, created_at desc);
create index if not exists quotation_share_links_artist_idx
  on public.quotation_share_links (artist_id);

comment on table public.quotation_share_links is
  'Enlaces públicos de una cotización (/cotizacion/<token>). El token viaja solo en el enlace; aquí se guarda su SHA-256. Solo service_role.';
comment on column public.quotation_share_links.claimed_by is
  'Usuario (cliente) que vinculó la cotización a su cuenta desde este enlace.';

alter table public.quotation_share_links enable row level security;

revoke all on table public.quotation_share_links from public, anon, authenticated;
grant select, insert, update, delete on table public.quotation_share_links to service_role;

-- Suma una vista solo si el enlace sigue vigente. La llama el servidor al
-- servir GET /api/cot-detalle/public/:token.
create or replace function public.touch_quotation_share_link(p_token_hash text)
returns void
language sql
set search_path to ''
as $function$
  update public.quotation_share_links
     set view_count = view_count + 1,
         last_viewed_at = timezone('utc', now())
   where token_hash = p_token_hash
     and revoked_at is null
     and expires_at > timezone('utc', now());
$function$;

revoke all on function public.touch_quotation_share_link(text) from public, anon, authenticated;
grant execute on function public.touch_quotation_share_link(text) to service_role;

commit;
