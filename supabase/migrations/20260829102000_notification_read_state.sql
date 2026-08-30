-- Durable read state for the shared artist notification panel.
-- The notification feed is derived from authoritative domain rows; this table
-- stores only recipient-owned read receipts so the same state follows the
-- artist across browsers without duplicating business events.

create table if not exists public.user_notification_reads (
  user_id uuid not null references auth.users (id) on delete cascade,
  notification_key text not null check (char_length(notification_key) between 1 and 240),
  read_at timestamptz not null default now(),
  primary key (user_id, notification_key)
);

create index if not exists idx_user_notification_reads_recent
  on public.user_notification_reads (user_id, read_at desc);

alter table public.user_notification_reads enable row level security;

drop policy if exists user_notification_reads_owner_select on public.user_notification_reads;
create policy user_notification_reads_owner_select on public.user_notification_reads
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_notification_reads_owner_insert on public.user_notification_reads;
create policy user_notification_reads_owner_insert on public.user_notification_reads
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_notification_reads_owner_update on public.user_notification_reads;
create policy user_notification_reads_owner_update on public.user_notification_reads
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_notification_reads_owner_delete on public.user_notification_reads;
create policy user_notification_reads_owner_delete on public.user_notification_reads
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_notification_reads_support_select on public.user_notification_reads;
create policy user_notification_reads_support_select on public.user_notification_reads
  for select to authenticated
  using (public.is_support_user());

revoke all on table public.user_notification_reads from anon;
revoke all on table public.user_notification_reads from authenticated;
grant select, insert, update, delete on table public.user_notification_reads to authenticated;
