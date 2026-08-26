-- Rediseño Bauhaus 2026 · /artist/applications: el artista debe poder seguir
-- viendo la solicitud/spot al que postuló aunque ya no esté abierto (las
-- policies actuales solo dan SELECT de open+public o del dueño).
-- Policies aditivas de solo lectura. Aplicadas al proyecto vivo el 25 ago 2026.

drop policy if exists "Artists can view requests they applied to" on public.job_board_requests;
create policy "Artists can view requests they applied to" on public.job_board_requests
  for select using (
    exists (
      select 1 from public.job_board_applications a
      where a.request_id = job_board_requests.id
        and a.artist_id = (select auth.uid())
    )
  );

drop policy if exists "Artists can view spots they applied to" on public.studio_spots;
create policy "Artists can view spots they applied to" on public.studio_spots
  for select using (
    exists (
      select 1 from public.studio_spot_applications sa
      where sa.spot_id = studio_spots.id
        and sa.artist_user_id = (select auth.uid())
    )
  );
