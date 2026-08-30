-- El logger hace INSERT ... RETURNING y luego UPDATE del mismo registro.
-- Permite esas operaciones sólo sobre la fila del usuario autenticado; conserva
-- el alta anónima únicamente cuando user_id es NULL.

drop policy if exists "Allow anonymous insert" on public.session_logs;
create policy "session_logs_insert_own"
on public.session_logs
for insert
to anon, authenticated
with check (
  ((select auth.uid()) is null and user_id is null)
  or user_id = (select auth.uid())
);

drop policy if exists "Allow update own logs" on public.session_logs;
create policy "session_logs_update_own"
on public.session_logs
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "session_logs_select_own"
on public.session_logs
for select
to authenticated
using (user_id = (select auth.uid()));
