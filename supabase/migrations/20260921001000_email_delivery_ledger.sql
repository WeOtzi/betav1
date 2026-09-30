-- Server-only delivery claims prevent duplicate mail across retries/restarts.
create table if not exists public.email_delivery_ledger (
    delivery_key text primary key,
    event_id text not null,
    state text not null default 'sending' check (state in ('sending', 'accepted', 'failed', 'uncertain')),
    result jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table public.email_delivery_ledger enable row level security;
revoke all on public.email_delivery_ledger from anon, authenticated;
grant all on public.email_delivery_ledger to service_role;

-- Routing may contain provider API keys and webhook URLs.
update public.app_settings set is_public = false where setting_key = 'email_routing';
