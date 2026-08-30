-- Follow-up from the post-migration advisors: cover the artist FK and avoid
-- `FOR ALL` policies contributing redundant SELECT policies.

create index if not exists idx_sicr_artist
  on public.studio_invitation_change_requests (artist_user_id);

drop policy if exists smid_studio_support_write
  on public.studio_membership_invitation_details;

create policy smid_studio_support_insert
on public.studio_membership_invitation_details
for insert
with check (
  exists (
    select 1
    from public.studio_artist_memberships m
    join public.studios s on s.id = m.studio_id
    where m.id = membership_id
      and (s.user_id = (select auth.uid()) or public.is_support_user())
  )
);

create policy smid_studio_support_update
on public.studio_membership_invitation_details
for update
using (
  exists (
    select 1
    from public.studio_artist_memberships m
    join public.studios s on s.id = m.studio_id
    where m.id = membership_id
      and (s.user_id = (select auth.uid()) or public.is_support_user())
  )
)
with check (
  exists (
    select 1
    from public.studio_artist_memberships m
    join public.studios s on s.id = m.studio_id
    where m.id = membership_id
      and (s.user_id = (select auth.uid()) or public.is_support_user())
  )
);

create policy smid_studio_support_delete
on public.studio_membership_invitation_details
for delete
using (
  exists (
    select 1
    from public.studio_artist_memberships m
    join public.studios s on s.id = m.studio_id
    where m.id = membership_id
      and (s.user_id = (select auth.uid()) or public.is_support_user())
  )
);

drop policy if exists sam_studio_or_support_write
  on public.studio_artist_memberships;

create policy sam_studio_or_support_insert
on public.studio_artist_memberships
for insert
with check (
  auth.uid() is not null
  and (
    exists (
      select 1 from public.studios s
      where s.id = studio_artist_memberships.studio_id
        and s.user_id = (select auth.uid())
    )
    or public.is_support_user()
  )
);

create policy sam_studio_or_support_update
on public.studio_artist_memberships
for update
using (
  auth.uid() is not null
  and (
    exists (
      select 1 from public.studios s
      where s.id = studio_artist_memberships.studio_id
        and s.user_id = (select auth.uid())
    )
    or public.is_support_user()
  )
)
with check (
  auth.uid() is not null
  and (
    exists (
      select 1 from public.studios s
      where s.id = studio_artist_memberships.studio_id
        and s.user_id = (select auth.uid())
    )
    or public.is_support_user()
  )
);

create policy sam_studio_or_support_delete
on public.studio_artist_memberships
for delete
using (
  auth.uid() is not null
  and (
    exists (
      select 1 from public.studios s
      where s.id = studio_artist_memberships.studio_id
        and s.user_id = (select auth.uid())
    )
    or public.is_support_user()
  )
);
