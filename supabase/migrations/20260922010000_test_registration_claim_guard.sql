-- Test registrations may use non-deliverable addresses. An auto-confirmed
-- address is not proof of ownership of historical guest quotations.
alter policy clients_update_own_quotations on public.quotations_db
using (
  client_user_id = auth.uid()
  or (
    client_user_id is null
    and coalesce(auth.jwt()->'app_metadata'->>'qa_unverified_email', 'false') <> 'true'
    and exists (select 1 from public.clients_db c where c.user_id=auth.uid() and lower(c.email)=lower(quotations_db.client_email))
  )
)
with check (client_user_id = auth.uid());
