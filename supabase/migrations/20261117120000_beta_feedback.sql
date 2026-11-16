-- ===========================================================================
-- Feedback de la beta cerrada (tatuadores, clientes y estudios).
-- ---------------------------------------------------------------------------
-- Una fila por envío del botón "Comentarios" (kind bug | idea | comment) o por
-- respuesta a una encuesta corta (kind survey + survey_key). "Ahora no" en una
-- encuesta también deja su fila (dismissed = true, sin rating ni mensaje), así
-- no se vuelve a preguntar esa clave.
--
-- Escribe y lee el servidor (lib/routes/feedback.js) con service-role: valida,
-- detecta el rol y aplica el tope diario. RLS queda activo igual, como
-- segunda barrera: la persona solo inserta y lee lo suyo (sin la nota interna
-- de soporte), no puede editar ni borrar, y anon no tiene acceso.
--
-- Capturas: rutas del bucket privado `support-attachments`
-- (`<uid>/feedback/<ts>-<rand>-<nombre>`); soporte las ve con URL firmada.
-- Idempotente. Reversa: supabase/rollbacks/20261117120000_beta_feedback.down.sql
-- ===========================================================================

begin;

create table if not exists public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  kind text not null,
  survey_key text,
  rating smallint,
  dismissed boolean not null default false,
  message text,
  page_path text,
  page_title text,
  context jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'new',
  support_note text,
  handled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_feedback_role_check check (role in ('artist', 'client', 'studio')),
  constraint beta_feedback_kind_check check (kind in ('bug', 'idea', 'comment', 'survey')),
  constraint beta_feedback_status_check check (status in ('new', 'seen', 'in_progress', 'done', 'wontfix')),
  constraint beta_feedback_rating_check check (rating is null or rating between 1 and 5),
  constraint beta_feedback_survey_key_check check (
    (kind = 'survey' and survey_key is not null and survey_key ~ '^[a-z0-9_]{3,40}$')
    or (kind <> 'survey' and survey_key is null)
  ),
  constraint beta_feedback_message_length_check check (
    message is null or char_length(message) between 1 and 2000
  ),
  constraint beta_feedback_message_required_check check (
    kind = 'survey' or (message is not null and char_length(btrim(message)) >= 10)
  ),
  constraint beta_feedback_survey_answer_check check (
    kind <> 'survey' or dismissed or rating is not null
  ),
  constraint beta_feedback_dismissed_check check (
    not dismissed or (kind = 'survey' and rating is null and message is null)
  ),
  constraint beta_feedback_page_path_check check (page_path is null or char_length(page_path) <= 300),
  constraint beta_feedback_page_title_check check (page_title is null or char_length(page_title) <= 200),
  constraint beta_feedback_context_check check (
    jsonb_typeof(context) = 'object' and pg_column_size(context) <= 4096
  ),
  constraint beta_feedback_attachments_check check (
    jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 2
  ),
  constraint beta_feedback_support_note_check check (support_note is null or char_length(support_note) <= 4000)
);

comment on table public.beta_feedback is
  'Feedback de la beta cerrada: botón "Comentarios" (bug/idea/comment) y encuestas cortas (survey). Lo escribe lib/routes/feedback.js; soporte lo gestiona en /support/dashboard#feedback.';
comment on column public.beta_feedback.dismissed is
  'Encuesta descartada con "Ahora no" o cerrando la tarjeta: no se vuelve a preguntar esa clave.';
comment on column public.beta_feedback.context is
  'Solo: idioma, ancho y alto de pantalla y user agent. Sin datos personales.';
comment on column public.beta_feedback.attachments is
  'Capturas: [{ path, name, size, type }] en el bucket privado support-attachments, carpeta <uid>/feedback/.';

-- Una sola fila por persona y encuesta (respondida o descartada).
create unique index if not exists beta_feedback_user_survey_uniq
  on public.beta_feedback (user_id, survey_key)
  where kind = 'survey';
create index if not exists beta_feedback_created_at_idx on public.beta_feedback (created_at desc);
create index if not exists beta_feedback_status_idx on public.beta_feedback (status, created_at desc);
create index if not exists beta_feedback_role_idx on public.beta_feedback (role, created_at desc);
-- Tope diario por persona (lib/routes/feedback.js cuenta las últimas 24 h).
create index if not exists beta_feedback_user_created_idx on public.beta_feedback (user_id, created_at desc);

create or replace function public.beta_feedback_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists beta_feedback_touch_updated_at on public.beta_feedback;
create trigger beta_feedback_touch_updated_at
  before update on public.beta_feedback
  for each row execute function public.beta_feedback_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------------
alter table public.beta_feedback enable row level security;

revoke all on table public.beta_feedback from public;
revoke all on table public.beta_feedback from anon;
revoke all on table public.beta_feedback from authenticated;
grant all on table public.beta_feedback to service_role;

-- La persona lee sus propias filas sin status, nota interna ni quién la gestionó.
grant select (id, user_id, role, kind, survey_key, rating, dismissed, message, page_path, page_title,
              context, attachments, created_at)
  on table public.beta_feedback to authenticated;
grant insert (user_id, role, kind, survey_key, rating, dismissed, message, page_path, page_title,
              context, attachments)
  on table public.beta_feedback to authenticated;

drop policy if exists beta_feedback_select_own on public.beta_feedback;
create policy beta_feedback_select_own
  on public.beta_feedback
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists beta_feedback_insert_own on public.beta_feedback;
create policy beta_feedback_insert_own
  on public.beta_feedback
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- status, support_note y handled_by quedan fuera del grant de insert: una fila
-- nueva siempre nace en 'new', sin nota ni responsable.
-- Sin políticas de update ni delete: la persona no puede editar ni borrar su
-- feedback. Soporte lo gestiona por el servidor (service-role).

commit;
