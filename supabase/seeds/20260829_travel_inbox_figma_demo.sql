-- Figma 144:1250 + Travel detail context demo for @isainazartattoo.wo.
-- Idempotent, isolated by fixed UUIDs and the [PRUEBA][INBOX-FIGMA] marker.

begin;

do $$
begin
  if not exists (
    select 1 from public.artists_db where lower(username) = 'isainazartattoo.wo'
  ) then
    raise exception 'Demo artist isainazartattoo.wo does not exist';
  end if;
end;
$$;

with target as (
  select user_id from public.artists_db where lower(username) = 'isainazartattoo.wo'
), seed(
  id, category, counterparty_name, initials, subject, context, status, priority, age
) as (
  values
    ('a1000000-0000-4000-8000-000000000001'::uuid,'clients','Camila R.','CR','Cambio de turno','{"demo_marker":"[PRUEBA][INBOX-FIGMA]","client":"Camila R.","appointment":"Sábado"}'::jsonb,'open',false,interval '2 minutes'),
    ('a1000000-0000-4000-8000-000000000002'::uuid,'clients','Rodrigo A.','RA','Sesión confirmada','{"demo_marker":"[PRUEBA][INBOX-FIGMA]","client":"Rodrigo A.","appointment":"12 de septiembre"}'::jsonb,'open',false,interval '5 hours'),
    ('a1000000-0000-4000-8000-000000000003'::uuid,'clients','Valentina Cruz','VC','Seguimiento del tatuaje','{"demo_marker":"[PRUEBA][INBOX-FIGMA]","client":"Valentina Cruz"}'::jsonb,'open',false,interval '2 days'),
    ('a1000000-0000-4000-8000-000000000004'::uuid,'quotations','Bruno T.','BT','Cotización prioritaria','{"demo_marker":"[PRUEBA][INBOX-FIGMA]","quote_id":"DEMO-R01","budget":"USD 900"}'::jsonb,'open',true,interval '1 day'),
    ('a1000000-0000-4000-8000-000000000005'::uuid,'quotations','Sofía L.','SL','Cotización cerrada','{"demo_marker":"[PRUEBA][INBOX-FIGMA]","quote_id":"DEMO-D01"}'::jsonb,'closed',false,interval '2 days'),
    ('a1000000-0000-4000-8000-000000000006'::uuid,'invitations','Fierro Negro Tattoo','FN','Invitación al roster','{"demo_marker":"[PRUEBA][INBOX-FIGMA]","invitation_status":"pending_acceptance"}'::jsonb,'open',false,interval '4 hours'),
    ('a1000000-0000-4000-8000-000000000007'::uuid,'spots','Costa Ink Collective','CI','Residencia de septiembre','{"demo_marker":"[PRUEBA][INBOX-FIGMA]","studio":"Costa Ink Collective","dates":"1 – 15 de septiembre","application_status":"accepted"}'::jsonb,'open',false,interval '3 days'),
    ('a1000000-0000-4000-8000-000000000008'::uuid,'job_board','Aurora Ink Collective','AI','Propuesta de Job Board','{"demo_marker":"[PRUEBA][INBOX-FIGMA]","application_status":"shortlisted","request_code":"JB-DEMO1"}'::jsonb,'open',true,interval '3 hours'),
    ('a1000000-0000-4000-8000-000000000009'::uuid,'studios','Estudio Cactus','EC','Coordinación con el estudio','{"demo_marker":"[PRUEBA][INBOX-FIGMA]","studio":"Estudio Cactus"}'::jsonb,'open',false,interval '4 days'),
    ('a1000000-0000-4000-8000-000000000010'::uuid,'trips','Marta Vidal — Costa Ink','MV','Viaje a Barcelona','{"demo_marker":"[PRUEBA][INBOX-FIGMA]","city":"Barcelona","studio":"Costa Ink","start_date":"2026-09-15","end_date":"2026-09-22"}'::jsonb,'open',false,interval '5 days'),
    ('a1000000-0000-4000-8000-000000000011'::uuid,'support','Soporte We Ötzi','WÖ','Ayuda con tu cuenta','{"demo_marker":"[PRUEBA][INBOX-FIGMA]","channel":"support"}'::jsonb,'open',false,interval '7 days')
)
insert into public.inbox_threads (
  id, artist_user_id, category, context_type, context_id,
  counterparty_name, counterparty_initials, subject, context,
  status, is_priority, created_at, updated_at
)
select
  s.id, t.user_id, s.category, 'figma_demo', s.id,
  s.counterparty_name, s.initials, s.subject, s.context,
  s.status, s.priority, now() - s.age - interval '1 day', now()
from seed s cross join target t
on conflict (id) do update set
  artist_user_id = excluded.artist_user_id,
  category = excluded.category,
  counterparty_name = excluded.counterparty_name,
  counterparty_initials = excluded.counterparty_initials,
  subject = excluded.subject,
  context = excluded.context,
  status = excluded.status,
  is_priority = excluded.is_priority,
  updated_at = now();

with target as (
  select user_id from public.artists_db where lower(username) = 'isainazartattoo.wo'
), thread_ids(id) as (
  values
    ('a1000000-0000-4000-8000-000000000001'::uuid),
    ('a1000000-0000-4000-8000-000000000002'::uuid),
    ('a1000000-0000-4000-8000-000000000003'::uuid),
    ('a1000000-0000-4000-8000-000000000004'::uuid),
    ('a1000000-0000-4000-8000-000000000005'::uuid),
    ('a1000000-0000-4000-8000-000000000006'::uuid),
    ('a1000000-0000-4000-8000-000000000007'::uuid),
    ('a1000000-0000-4000-8000-000000000008'::uuid),
    ('a1000000-0000-4000-8000-000000000009'::uuid),
    ('a1000000-0000-4000-8000-000000000010'::uuid),
    ('a1000000-0000-4000-8000-000000000011'::uuid)
)
insert into public.inbox_thread_participants (
  thread_id, user_id, participant_role, last_read_at, is_favorite, is_archived
)
select
  x.id, t.user_id, 'artist',
  case x.id
    when 'a1000000-0000-4000-8000-000000000001'::uuid then now() - interval '20 minutes'
    when 'a1000000-0000-4000-8000-000000000004'::uuid then now() - interval '2 days'
    when 'a1000000-0000-4000-8000-000000000006'::uuid then now() - interval '1 day'
    when 'a1000000-0000-4000-8000-000000000008'::uuid then now() - interval '2 days'
    else now()
  end,
  x.id = 'a1000000-0000-4000-8000-000000000007'::uuid,
  x.id = 'a1000000-0000-4000-8000-000000000011'::uuid
from thread_ids x cross join target t
on conflict (thread_id, user_id) do update set
  last_read_at = excluded.last_read_at,
  is_favorite = excluded.is_favorite,
  is_archived = excluded.is_archived;

delete from public.inbox_messages
where id between 'b1000000-0000-4000-8000-000000000001'::uuid
             and 'b1000000-0000-4000-8000-000000000030'::uuid;

with target as (
  select user_id from public.artists_db where lower(username) = 'isainazartattoo.wo'
), seed(id, thread_id, sender_side, sender_role, body, age) as (
  values
    ('b1000000-0000-4000-8000-000000000001'::uuid,'a1000000-0000-4000-8000-000000000001'::uuid,'artist','artist','Sí, puedo moverla. ¿Te sirve por la tarde?',interval '40 minutes'),
    ('b1000000-0000-4000-8000-000000000002'::uuid,'a1000000-0000-4000-8000-000000000001'::uuid,'other','client','¿Podemos mover la sesión al sábado?',interval '15 minutes'),
    ('b1000000-0000-4000-8000-000000000003'::uuid,'a1000000-0000-4000-8000-000000000001'::uuid,'other','client','A partir de las 14 me queda perfecto.',interval '2 minutes'),
    ('b1000000-0000-4000-8000-000000000004'::uuid,'a1000000-0000-4000-8000-000000000002'::uuid,'other','client','Genial, ¡nos vemos el 12!',interval '5 hours'),
    ('b1000000-0000-4000-8000-000000000005'::uuid,'a1000000-0000-4000-8000-000000000002'::uuid,'artist','artist','Perfecto, quedó agendado.',interval '4 hours'),
    ('b1000000-0000-4000-8000-000000000006'::uuid,'a1000000-0000-4000-8000-000000000003'::uuid,'other','client','Mil gracias, ¡quedó hermoso el tatuaje!',interval '2 days'),
    ('b1000000-0000-4000-8000-000000000007'::uuid,'a1000000-0000-4000-8000-000000000003'::uuid,'artist','artist','Gracias a vos, cuidalo mucho.',interval '1 day 23 hours'),
    ('b1000000-0000-4000-8000-000000000008'::uuid,'a1000000-0000-4000-8000-000000000004'::uuid,'other','client','¿Podrías bajar un poco el precio?',interval '1 day'),
    ('b1000000-0000-4000-8000-000000000009'::uuid,'a1000000-0000-4000-8000-000000000005'::uuid,'other','client','Voy a seguir buscando, gracias',interval '2 days'),
    ('b1000000-0000-4000-8000-000000000010'::uuid,'a1000000-0000-4000-8000-000000000006'::uuid,'other','studio','Esperamos tu respuesta a la invitación.',interval '4 hours'),
    ('b1000000-0000-4000-8000-000000000011'::uuid,'a1000000-0000-4000-8000-000000000007'::uuid,'artist','artist','Confirmo mi interés en la próxima residencia de septiembre.',interval '3 days 1 hour'),
    ('b1000000-0000-4000-8000-000000000012'::uuid,'a1000000-0000-4000-8000-000000000007'::uuid,'other','studio','Perfecto, mandanos tus fechas confirmadas',interval '3 days'),
    ('b1000000-0000-4000-8000-000000000013'::uuid,'a1000000-0000-4000-8000-000000000008'::uuid,'other','client','Nos encantó tu propuesta, ¿podemos coordinar una llamada?',interval '4 hours'),
    ('b1000000-0000-4000-8000-000000000014'::uuid,'a1000000-0000-4000-8000-000000000008'::uuid,'other','client','Tenemos disponibilidad mañana.',interval '3 hours 30 minutes'),
    ('b1000000-0000-4000-8000-000000000015'::uuid,'a1000000-0000-4000-8000-000000000008'::uuid,'other','client','¿Te sirve a las 11?',interval '3 hours'),
    ('b1000000-0000-4000-8000-000000000016'::uuid,'a1000000-0000-4000-8000-000000000009'::uuid,'other','studio','Cualquier cosa avisanos',interval '4 days'),
    ('b1000000-0000-4000-8000-000000000017'::uuid,'a1000000-0000-4000-8000-000000000009'::uuid,'artist','artist','Gracias, ya tengo todos los datos.',interval '3 days 23 hours'),
    ('b1000000-0000-4000-8000-000000000018'::uuid,'a1000000-0000-4000-8000-000000000010'::uuid,'other','studio','Te esperamos el 15 en el estudio, cualquier cosa por acá',interval '5 days'),
    ('b1000000-0000-4000-8000-000000000019'::uuid,'a1000000-0000-4000-8000-000000000010'::uuid,'artist','artist','Perfecto, llego por la mañana.',interval '4 days 23 hours'),
    ('b1000000-0000-4000-8000-000000000020'::uuid,'a1000000-0000-4000-8000-000000000011'::uuid,'other','support','Hola, somos el equipo de soporte. ¿En qué podemos ayudarte?',interval '7 days')
)
insert into public.inbox_messages (
  id, thread_id, sender_user_id, sender_role, body, message_kind, created_at
)
select
  s.id, s.thread_id,
  case when s.sender_side = 'artist' then t.user_id else null end,
  s.sender_role, s.body, 'text', now() - s.age
from seed s cross join target t;

-- Refresh read timestamps after message triggers updated the summaries.
update public.inbox_thread_participants p
set last_read_at = now()
where p.user_id = (select user_id from public.artists_db where lower(username) = 'isainazartattoo.wo')
  and p.thread_id in (
    'a1000000-0000-4000-8000-000000000002'::uuid,
    'a1000000-0000-4000-8000-000000000003'::uuid,
    'a1000000-0000-4000-8000-000000000005'::uuid,
    'a1000000-0000-4000-8000-000000000007'::uuid,
    'a1000000-0000-4000-8000-000000000009'::uuid,
    'a1000000-0000-4000-8000-000000000010'::uuid
  );

commit;

-- Rollback (demo only):
-- delete from public.inbox_threads
-- where context->>'demo_marker' = '[PRUEBA][INBOX-FIGMA]'
--   and artist_user_id = (select user_id from public.artists_db where lower(username)='isainazartattoo.wo');
