-- Travel satellite ACL hardening.
--
-- The original table bootstrap used broad grants that also exposed TRUNCATE,
-- TRIGGER and REFERENCES to `authenticated`. RLS does not govern TRUNCATE, so
-- replace those grants with the exact DML exercised by the artist workspace.

begin;

revoke all privileges on table
  public.trip_checklist_items,
  public.trip_documents,
  public.trip_events,
  public.trip_studio_links
from authenticated;

grant select, insert, update, delete
  on table public.trip_checklist_items
  to authenticated;

grant select, insert, delete
  on table public.trip_documents
  to authenticated;

grant select, insert
  on table public.trip_events
  to authenticated;

grant select
  on table public.trip_studio_links
  to authenticated;

notify pgrst, 'reload schema';

commit;
