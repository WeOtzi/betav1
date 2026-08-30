-- Dashboard Figma demo dataset for @isainazartattoo.wo
-- Reference: Figma Pantallas We Otzi, node 24:1424
-- Marker: [PRUEBA][DASHBOARD-ISAINAZ-20260829]
-- Idempotent on quote_id, request_code, membership/application unique keys, and
-- trip natural keys. Existing gallery media is preserved and reused as imagery.

begin;

-- The Dashboard reads this explicit set so historical test quotations owned by
-- the same artist do not alter the 3 / 8 / 1 Figma counters.
update public.artists_db
set dashboard_config = coalesce(dashboard_config, '{}'::jsonb) || jsonb_build_object(
      'dashboard_demo_marker', '[PRUEBA][DASHBOARD-ISAINAZ-20260829]',
      'dashboard_demo_quote_ids', jsonb_build_array(
        'DEMO-P01','DEMO-P02','DEMO-P03',
        'DEMO-D01','DEMO-D02','DEMO-D03','DEMO-D04','DEMO-D05',
        'DEMO-C01','DEMO-C02','DEMO-C03','DEMO-C04','DEMO-R01'
      ),
      'dashboard_demo_design_quote_ids', jsonb_build_array('DEMO-D01','DEMO-D02','DEMO-D03'),
      'dashboard_design_progress', jsonb_build_object('DEMO-D01',75,'DEMO-D02',40,'DEMO-D03',90)
    )
where lower(username) = 'isainazartattoo.wo';

insert into public.user_preferences (user_id, notification_prefs, privacy, app_settings, updated_at)
select a.user_id,
       jsonb_build_object(
         'quote_new', jsonb_build_object('email', true),
         'message_new', jsonb_build_object('email', true),
         'session_reminder', jsonb_build_object('email', true)
       ),
       jsonb_build_object('show_city', true, 'show_socials', true, 'allow_search_indexing', true),
       jsonb_build_object(
         'demo_marker', '[PRUEBA][DASHBOARD-ISAINAZ-20260829]',
         'reminders', jsonb_build_array(
           jsonb_build_object('text','Reponer tinta negra','type','stock','done',false),
           jsonb_build_object('text','Enviar boceto a Camila','type','sketch','done',false),
           jsonb_build_object('text','Responder WhatsApp de Nico','type','message','done',false),
           jsonb_build_object('text','Cobrar saldo · Mateo','type','payment','done',false)
         ),
         'dashboard_activity', jsonb_build_array(
           jsonb_build_object('text','Sofía confirmó su turno','type','confirmation','created_at',now() - interval '12 minutes'),
           jsonb_build_object('text','Pago recibido · Mateo · $180','type','payment','created_at',now() - interval '1 hour'),
           jsonb_build_object('text','Nueva cotización de Camila Soto','type','quote','created_at',now() - interval '2 hours'),
           jsonb_build_object('text','Reseña 5★ de Julia Ferrer','type','review','created_at',now() - interval '1 day')
         )
       ),
       now()
from public.artists_db a
where lower(a.username) = 'isainazartattoo.wo'
on conflict (user_id) do update set
  notification_prefs = public.user_preferences.notification_prefs || excluded.notification_prefs,
  privacy = public.user_preferences.privacy || excluded.privacy,
  app_settings = public.user_preferences.app_settings || excluded.app_settings,
  updated_at = excluded.updated_at;

with seed(
  quote_id, quote_status, age_days, update_days, client_email, client_name,
  body_part, idea, project_name, style_name, sessions, artist_amount, final_amount,
  current_step, deadline_days, completed
) as (
  values
    ('DEMO-P01','pending',0,0,'demo-client1@weotzi.test','Camila Soto','Antebrazo','Retrato botánico con líneas finas.','Retrato botánico','Realismo',null,null,null,null,null,false),
    ('DEMO-P02','pending',1,1,'demo-client2@weotzi.test','Nicolás Duarte','Pantorrilla','Personaje anime en movimiento.','Anime dinámico','Anime',null,null,null,null,null,false),
    ('DEMO-P03','pending',2,2,'demo-client3@weotzi.test','Valentina Ríos','Muslo','Composición floral Art Nouveau.','Flores Art Nouveau','Art Nouveau',null,null,null,null,null,false),
    ('DEMO-D01','client_approved',9,1,'demo-client1@weotzi.test','Sofía Martínez','Brazo completo','Manga floral en fine line.','Manga floral','Fine line','3','250',null,'ENTINTADO',12,false),
    ('DEMO-D02','client_approved',14,2,'demo-client2@weotzi.test','Mateo Ruiz','Espalda','Dragón japonés para espalda.','Dragón espalda','Japonés','4','220',null,'BOCETO',20,false),
    ('DEMO-D03','artist_completed',20,3,'demo-client3@weotzi.test','Lucía Beltrán','Hombro','Mandala geométrico en dotwork.','Mandala geométrico','Dotwork','2','180','180','FINAL',28,false),
    ('DEMO-D04','client_approved',5,1,'demo-client1@weotzi.test','Julia Ferrer','Muñeca','Retoque de líneas finas.','Retoque muñeca','Fine line','1',null,null,'BOCETO',8,false),
    ('DEMO-D05','client_approved',3,1,'demo-client2@weotzi.test','Tomás Vega','Pierna','Consulta de boceto realista.','Consulta boceto','Realismo','2',null,null,'BOCETO',15,false),
    ('DEMO-C01','completed',12,2,'demo-client1@weotzi.test','Martín Aguirre','Brazo','Retrato realista finalizado.','Retrato finalizado','Realismo','2','1240','1240','FINAL',null,true),
    ('DEMO-C02','completed',18,11,'demo-client2@weotzi.test','Paula Giménez','Antebrazo','Dotwork ornamental finalizado.','Ornamental finalizado','Dotwork','1','980','980','FINAL',null,true),
    ('DEMO-C03','completed',25,17,'demo-client3@weotzi.test','Franco Medina','Espalda alta','Pointillism de gran formato.','Pointillism finalizado','Pointillism','3','1600','1600','FINAL',null,true),
    ('DEMO-C04','completed',28,21,'demo-client1@weotzi.test','Rocío Cabrera','Clavícula','Fine line botánico finalizado.','Fine line finalizado','Fine line','1','1000','1000','FINAL',null,true),
    ('DEMO-R01','client_rejected',30,26,'demo-client2@weotzi.test','Bruno Tapia','Hombro','Blackwork de alto contraste.','Blackwork hombro','Blackwork',null,'900',null,null,null,false)
), target as (
  select user_id, name, username, email, city, session_price_amount::text session_price, session_price_currency
  from public.artists_db where lower(username)='isainazartattoo.wo'
), gallery as (
  select gallery_images from public.artists_db where lower(username)='isainazartattoo.wo'
)
insert into public.quotations_db (
  quote_id, quote_status, created_at, updated_at,
  tattoo_body_part, tattoo_idea_description, project_description, tattoo_style,
  tattoo_color_type, tattoo_estimated_sessions, client_full_name, client_email,
  client_city_residence, client_user_id, artist_id, artist_name, artist_username,
  artist_email, artist_current_city, artist_session_cost_amount, artist_session_cost_currency,
  artist_budget_amount, artist_budget_currency, final_budget_amount, final_budget_currency,
  final_sessions, current_step, client_preferred_date, reference_images_count,
  reference_images, source, sent_to_artist_at, artist_responded_at,
  artist_completed_at, client_completed_at, completed_by_client_user_id,
  notes, is_archived
)
select s.quote_id, s.quote_status, now() - make_interval(days => s.age_days), now() - make_interval(days => s.update_days),
       s.body_part, s.idea, s.project_name, jsonb_build_array(s.style_name),
       'Negro y gris', s.sessions, s.client_name, c.email,
       coalesce(c.city_residence,'Buenos Aires'), c.user_id, t.user_id, t.name, t.username,
       t.email, coalesce(t.city,'Buenos Aires'), t.session_price, t.session_price_currency,
       s.artist_amount, 'USD', s.final_amount, 'USD',
       s.sessions, s.current_step,
       case when s.deadline_days is null then null else (current_date + s.deadline_days)::text end,
       case when s.quote_id in ('DEMO-D01','DEMO-D02','DEMO-D03','DEMO-D04','DEMO-D05','DEMO-P01','DEMO-P02') then 1 else 0 end,
       case when s.quote_id in ('DEMO-D01','DEMO-D02','DEMO-D03','DEMO-D04','DEMO-D05','DEMO-P01','DEMO-P02')
            then jsonb_build_array(g.gallery_images -> ((substring(s.quote_id from '[0-9]+')::int - 1) % 8))
            else '[]'::jsonb end,
       'direct', now() - make_interval(days => s.age_days),
       case when s.quote_status <> 'pending' then now() - make_interval(days => s.update_days) end,
       case when s.quote_status in ('artist_completed','completed') then now() - make_interval(days => s.update_days) end,
       case when s.completed then now() - make_interval(days => s.update_days) end,
       case when s.completed then c.user_id end,
       '[PRUEBA][DASHBOARD-ISAINAZ-20260829]', false
from seed s
cross join target t
cross join gallery g
left join public.clients_db c on lower(c.email)=lower(s.client_email)
on conflict (quote_id) do update set
  quote_status=excluded.quote_status, created_at=excluded.created_at, updated_at=excluded.updated_at,
  tattoo_body_part=excluded.tattoo_body_part, tattoo_idea_description=excluded.tattoo_idea_description,
  project_description=excluded.project_description, tattoo_style=excluded.tattoo_style,
  tattoo_color_type=excluded.tattoo_color_type, tattoo_estimated_sessions=excluded.tattoo_estimated_sessions,
  client_full_name=excluded.client_full_name, client_email=excluded.client_email,
  client_city_residence=excluded.client_city_residence, client_user_id=excluded.client_user_id,
  artist_id=excluded.artist_id, artist_name=excluded.artist_name, artist_username=excluded.artist_username,
  artist_email=excluded.artist_email, artist_current_city=excluded.artist_current_city,
  artist_session_cost_amount=excluded.artist_session_cost_amount,
  artist_session_cost_currency=excluded.artist_session_cost_currency,
  artist_budget_amount=excluded.artist_budget_amount, artist_budget_currency=excluded.artist_budget_currency,
  final_budget_amount=excluded.final_budget_amount, final_budget_currency=excluded.final_budget_currency,
  final_sessions=excluded.final_sessions, current_step=excluded.current_step,
  client_preferred_date=excluded.client_preferred_date,
  reference_images_count=excluded.reference_images_count, reference_images=excluded.reference_images,
  source=excluded.source, sent_to_artist_at=excluded.sent_to_artist_at,
  artist_responded_at=excluded.artist_responded_at,
  artist_completed_at=excluded.artist_completed_at, client_completed_at=excluded.client_completed_at,
  completed_by_client_user_id=excluded.completed_by_client_user_id,
  notes=excluded.notes, is_archived=false;

-- Sessions: four local-time appointments reproduce the Figma agenda exactly.
delete from public.quotation_sessions
where quotation_id in (select id from public.quotations_db where quote_id like 'DEMO-%');

insert into public.quotation_sessions (quotation_id, session_number, session_date, duration_hours, status, notes)
select q.id, v.session_number,
       case when v.local_time is not null
            then ((current_date::text || ' ' || v.local_time || ' America/Argentina/Buenos_Aires')::timestamptz)
            else now() + make_interval(days => v.day_offset) end,
       v.duration_hours, v.status, v.notes
from (values
  ('DEMO-D01',1,null::text,-10,3.0::numeric,'completed','Sesión 1 · línea'),
  ('DEMO-D01',2,'10:00',0,3.0,'scheduled','Primera sesión · Brazo completo'),
  ('DEMO-D01',3,null,12,3.0,'scheduled','Sesión 3 · color'),
  ('DEMO-D02',1,null,-15,4.0,'completed','Sesión 1 · boceto y línea'),
  ('DEMO-D02',2,'13:30',0,2.0,'scheduled','Sesión 2/3 · Espalda · dragón'),
  ('DEMO-D02',3,null,20,3.0,'scheduled','Sesión 3/4 · sombras'),
  ('DEMO-D03',1,null,-21,2.5,'completed','Sesión 1 · dotwork'),
  ('DEMO-D03',2,null,-7,2.0,'completed','Sesión 2 · cierre'),
  ('DEMO-D04',1,'16:00',0,1.0,'rescheduled','Retoque · Muñeca'),
  ('DEMO-D05',1,'18:30',0,0.75,'scheduled','Consulta · Boceto nuevo')
) as v(quote_id,session_number,local_time,day_offset,duration_hours,status,notes)
join public.quotations_db q using (quote_id);

delete from public.quotations_attachments where quotation_id like 'DEMO-%';
with target as (
  select gallery_images from public.artists_db where lower(username)='isainazartattoo.wo'
), media(quote_id,idx,file_name) as (values
  ('DEMO-D01',0,'manga-floral.jpg'),('DEMO-D02',1,'dragon-espalda.jpg'),
  ('DEMO-D03',2,'mandala-geometrico.jpg'),('DEMO-D04',3,'retoque-muneca.jpg'),
  ('DEMO-D05',4,'consulta-boceto.jpg'),('DEMO-P01',5,'referencia-camila.jpg'),
  ('DEMO-P02',6,'referencia-nicolas.jpg'),('DEMO-C01',7,'trabajo-finalizado.jpg')
)
insert into public.quotations_attachments (
  quotation_id, google_drive_url, file_name, mime_type, attachment_type, status, sort_order
)
select m.quote_id, t.gallery_images ->> m.idx, m.file_name, 'image/jpeg', 'reference', 'confirmed', 0
from media m cross join target t;

-- Unread messages, pending quotes, a studio invitation, and spot decisions feed
-- the existing shared notification menu; no parallel notifications table exists.
delete from public.chat_messages where quotation_id like 'DEMO-%';
insert into public.chat_messages (quotation_id, sender_type, sender_id, message, is_read, created_at)
select q.quote_id, v.sender_type,
       case when v.sender_type='artist' then q.artist_id else q.client_user_id end,
       v.message, v.is_read, now() - v.age
from (values
  ('DEMO-P01','client','Hola, te paso más referencias del retrato. ¿Te sirven?',false,interval '35 minutes'),
  ('DEMO-D01','client','Confirmo el turno de hoy, ¡gracias!',false,interval '12 minutes'),
  ('DEMO-D02','client','¿Podemos mover la sesión del viernes una hora más tarde?',false,interval '3 hours'),
  ('DEMO-D04','artist','Te espero a las 16. Traé la crema que te indiqué.',true,interval '1 day')
) v(quote_id,sender_type,message,is_read,age)
join public.quotations_db q using (quote_id);

-- Job Board requests and applications.
with target as (
  select user_id from public.artists_db where lower(username)='isainazartattoo.wo'
), seed(request_code,client_email,idea,body_part,style_name,city,budget_min,budget_max,created_days) as (values
  ('JB-DEMO1','demo-newclient3@weotzi.test','Lobo aullando en blackwork, antebrazo completo.','Antebrazo','Blackwork','Buenos Aires',300,500,4),
  ('JB-DEMO2','demo-newclient33@weotzi.test','Retrato realista de mascota en el brazo.','Brazo','Realismo','Córdoba',200,350,11)
)
insert into public.job_board_requests (
  request_code,client_user_id,tattoo_body_part,tattoo_idea_description,tattoo_style,
  client_city,client_country,client_travel_willing,client_budget_min,client_budget_max,
  client_budget_currency,status,application_count,is_public,created_at,updated_at,expires_at
)
select s.request_code,c.user_id,s.body_part,s.idea,jsonb_build_array(s.style_name),
       s.city,'Argentina',true,s.budget_min,s.budget_max,'USD','open',1,true,
       now()-make_interval(days=>s.created_days),now(),now()+interval '30 days'
from seed s join public.clients_db c on lower(c.email)=lower(s.client_email)
on conflict (request_code) do update set
  client_user_id=excluded.client_user_id,tattoo_body_part=excluded.tattoo_body_part,
  tattoo_idea_description=excluded.tattoo_idea_description,tattoo_style=excluded.tattoo_style,
  client_city=excluded.client_city,client_country=excluded.client_country,
  client_budget_min=excluded.client_budget_min,client_budget_max=excluded.client_budget_max,
  status='open',application_count=1,is_public=true,updated_at=now(),expires_at=excluded.expires_at;

with target as (
  select user_id from public.artists_db where lower(username)='isainazartattoo.wo'
), apps(request_code,message,price,sessions,status,days) as (values
  ('JB-DEMO1','Me encanta la idea del lobo. Lo haría en blackwork con sombras suaves.','420 USD',2,'viewed',3),
  ('JB-DEMO2','Trabajo retratos de mascotas en realismo y puedo resolverlo en una sesión larga.','320 USD',1,'pending',2)
)
insert into public.job_board_applications (
  request_id,artist_id,message,estimated_price,estimated_sessions,availability_note,
  portfolio_links,status,created_at,updated_at
)
select r.id,t.user_id,a.message,a.price,a.sessions,'Disponible este mes',
       array['/artist/profile?artist=isainazartattoo.wo'],a.status,
       now()-make_interval(days=>a.days),now()
from apps a join public.job_board_requests r using(request_code) cross join target t
on conflict (request_id,artist_id) do update set
  message=excluded.message,estimated_price=excluded.estimated_price,
  estimated_sessions=excluded.estimated_sessions,availability_note=excluded.availability_note,
  portfolio_links=excluded.portfolio_links,status=excluded.status,updated_at=now();

-- Studio invitation plus open spots and artist applications.
insert into public.studio_artist_memberships (
  studio_id,artist_user_id,role,status,invited_at,notes,updated_at
)
select s.id,a.user_id,'guest','pending_acceptance',now()-interval '20 minutes',
       'Te invitamos como guest artist para la temporada de primavera. [PRUEBA DASHBOARD]',now()
from public.studios s cross join public.artists_db a
where s.slug='la-aguja-negra' and lower(a.username)='isainazartattoo.wo'
on conflict (studio_id,artist_user_id,role,status) do update set
  invited_at=excluded.invited_at,notes=excluded.notes,updated_at=now();

insert into public.studio_spots (
  studio_id,title,kind,description,styles_wanted,experience_min_years,language_requirements,
  includes_housing,revenue_split_pct,start_date,end_date,status,max_applications,
  application_count,expires_at,cover_image,updated_at
)
select s.id,v.title,v.kind,v.description,v.styles,v.experience,v.languages,
       v.housing,v.split,current_date+v.start_days,current_date+v.end_days,'open',20,1,
       now()+interval '30 days',v.cover_image,now()
from (values
  ('palermo-tattoo-club','Guest spot · Buenos Aires · 4 semanas','guest_spot','Guest spot demo para el Dashboard. [PRUEBA DASHBOARD]',array['Fine line','Blackwork'],2,array['Español'],false,70::numeric,20,48,'https://flbgmlvfiejfttlawnfu.supabase.co/storage/v1/object/public/artist-gallery/instagram-import/e5e3be81-784d-469c-bb86-13952f2a0c08/987cf363ea1b.jpg'),
  ('bang-bang-nyc','Residency · NYC · 3 a 6 meses','resident','Residencia demo para el Dashboard. [PRUEBA DASHBOARD]',array['Realismo','Fine line'],3,array['Inglés'],true,60::numeric,45,135,'https://flbgmlvfiejfttlawnfu.supabase.co/storage/v1/object/public/artist-gallery/instagram-import/e5e3be81-784d-469c-bb86-13952f2a0c08/4f8204215e2f.jpg')
) v(slug,title,kind,description,styles,experience,languages,housing,split,start_days,end_days,cover_image)
join public.studios s using(slug)
where not exists (select 1 from public.studio_spots x where x.studio_id=s.id and x.title=v.title);

update public.studio_spots s
set description = case when description like '%[PRUEBA DASHBOARD]%' then description
                       else coalesce(description,'') || ' [PRUEBA DASHBOARD]' end,
    updated_at=now()
where title in ('Guest spot · Buenos Aires · 4 semanas','Residency · NYC · 3 a 6 meses');

with target as (
  select user_id from public.artists_db where lower(username)='isainazartattoo.wo'
), seed(title,status,days,message) as (values
  ('Guest spot · Buenos Aires · 4 semanas','pending',null::int,'Me interesa el guest spot y tengo disponibilidad completa.'),
  ('Residency · NYC · 3 a 6 meses','shortlisted',2,'Quiero sumarme a la residencia y puedo trabajar en inglés.')
)
insert into public.studio_spot_applications (
  spot_id,artist_user_id,message,portfolio_url,requested_dates,status,created_at,decided_at
)
select s.id,t.user_id,v.message,'/artist/profile?artist=isainazartattoo.wo',
       daterange(s.start_date,s.end_date,'[]'),v.status,now()-interval '3 days',
       case when v.days is null then null else now()-make_interval(days=>v.days) end
from seed v join public.studio_spots s using(title) cross join target t
on conflict (spot_id,artist_user_id) do update set
  message=excluded.message,portfolio_url=excluded.portfolio_url,
  requested_dates=excluded.requested_dates,status=excluded.status,
  decided_at=excluded.decided_at;

-- Travel history and planning. Natural keys keep reruns idempotent.
with target as (
  select user_id from public.artists_db where lower(username)='isainazartattoo.wo'
), trips(city,country,start_date,end_date,trip_type,status,studio,event_name,notes,share_slug,share_enabled) as (values
  ('Barcelona','España',date '2026-09-22',date '2026-10-06','guest_spot','confirmado','Zorro Rojo Tattoo',null,'Llevar máquinas de línea y cartuchos 3RL','br-zorro-rojo-sep26',true),
  ('Madrid','España',date '2026-10-08',date '2026-10-15','guest_spot','pendiente','La Nave Tattoo',null,'Confirmar fechas con el estudio',null,false),
  ('Ciudad de México','México',date '2026-11-12',date '2026-11-19','convencion','planificado',null,'Expo Tattoo México','Sacar pasajes con anticipación',null,false),
  ('Montevideo','Uruguay',date '2026-07-15',date '2026-07-22','guest_spot','finalizado','Ink Society',null,'Buena respuesta, repetir el año que viene',null,false),
  ('Lima','Perú',date '2026-05-25',date '2026-06-01','guest_spot','finalizado','Costa Ink Collective',null,null,null,false)
)
insert into public.artist_trips (
  artist_user_id,city,country,start_date,end_date,trip_type,status,origin,
  studio_name_hint,event_name,personal_notes,share_slug,share_enabled,updated_at
)
select t.user_id,v.city,v.country,v.start_date,v.end_date,v.trip_type,v.status,'manual',
       v.studio,v.event_name,v.notes,v.share_slug,v.share_enabled,now()
from trips v cross join target t
where not exists (
  select 1 from public.artist_trips x
  where x.artist_user_id=t.user_id and x.city=v.city and x.start_date=v.start_date and x.end_date=v.end_date
);

insert into public.trip_checklist_items (trip_id,label,is_done,is_custom,sort_order)
select t.id,v.label,v.done,v.custom,v.sort_order
from public.artist_trips t
cross join (values
  ('Comprar pasajes',true,false,1),('Confirmar estudio',true,false,2),
  ('Preparar insumos',false,false,3),('Publicar agenda del viaje',false,true,4)
) v(label,done,custom,sort_order)
where t.artist_user_id=(select user_id from public.artists_db where lower(username)='isainazartattoo.wo')
  and t.city='Barcelona'
  and not exists (select 1 from public.trip_checklist_items c where c.trip_id=t.id and c.label=v.label);

insert into public.trip_events (trip_id,event_type,detail,event_date)
select t.id,v.event_type,v.detail,v.event_date
from public.artist_trips t
cross join (values
  ('creado','Viaje demo creado',date '2026-08-20'),
  ('estudio_confirmado','Zorro Rojo Tattoo confirmó el guest spot',date '2026-08-24'),
  ('nota','Agenda de Barcelona abierta',date '2026-08-28')
) v(event_type,detail,event_date)
where t.artist_user_id=(select user_id from public.artists_db where lower(username)='isainazartattoo.wo')
  and t.city='Barcelona'
  and not exists (select 1 from public.trip_events e where e.trip_id=t.id and e.event_type=v.event_type and e.detail=v.detail);

insert into public.trip_studio_links (trip_id,studio_id,studio_name,studio_city,status,requested_at,resolved_at)
select t.id,s.id,'Sang Bleu London','London','confirmada',now()-interval '10 days',now()-interval '6 days'
from public.artist_trips t left join public.studios s on s.slug='sang-bleu-london'
where t.artist_user_id=(select user_id from public.artists_db where lower(username)='isainazartattoo.wo')
  and t.city='Barcelona'
  and not exists (select 1 from public.trip_studio_links l where l.trip_id=t.id and l.studio_name='Sang Bleu London');

-- Verified 5-star review backing the Activity item.
delete from public.verified_reviews
where reviewee_user_id=(select user_id from public.artists_db where lower(username)='isainazartattoo.wo')
  and comment like '%[PRUEBA DASHBOARD-ISAINAZ-20260829]%';

insert into public.verified_reviews (
  context_type,quotation_id,reviewer_type,reviewer_user_id,
  reviewer_display_name,reviewer_country,reviewee_type,reviewee_user_id,
  reviewee_display_name,rating,comment,tags,photo_urls,moderation_status,
  approved_at,is_public,created_at,updated_at
)
select 'quotation',q.id,'client',q.client_user_id,'Julia Ferrer','Argentina',
       'artist',q.artist_id,'ISAINAZARTATTOO.WO',5,
       'Una experiencia excelente y un trabajo impecable. [PRUEBA DASHBOARD-ISAINAZ-20260829]',
       array['trato','resultado','puntualidad'],array[a.gallery_images->>3],
       'approved',now()-interval '1 day',true,now()-interval '1 day',now()-interval '1 day'
from public.quotations_db q
join public.artists_db a on a.user_id=q.artist_id
where q.quote_id='DEMO-C01';

commit;

-- Scoped rollback (run manually only if the demo must be removed):
-- delete from public.verified_reviews where comment like '%[PRUEBA DASHBOARD-ISAINAZ-20260829]%';
-- delete from public.chat_messages where quotation_id like 'DEMO-%';
-- delete from public.quotations_db where quote_id like 'DEMO-%'; -- cascades sessions/attachments/chat
-- delete from public.job_board_requests where request_code in ('JB-DEMO1','JB-DEMO2'); -- cascades applications
-- delete from public.studio_artist_memberships
-- where artist_user_id=(select user_id from public.artists_db where lower(username)='isainazartattoo.wo')
--   and notes like '%[PRUEBA DASHBOARD]%';
-- delete from public.studio_spots where description like '%[PRUEBA DASHBOARD]%'; -- cascades demo spot applications
-- delete from public.artist_trips
-- where artist_user_id=(select user_id from public.artists_db where lower(username)='isainazartattoo.wo')
--   and (city,start_date,end_date) in (
--     ('Barcelona',date '2026-09-22',date '2026-10-06'),
--     ('Madrid',date '2026-10-08',date '2026-10-15'),
--     ('Ciudad de México',date '2026-11-12',date '2026-11-19'),
--     ('Montevideo',date '2026-07-15',date '2026-07-22'),
--     ('Lima',date '2026-05-25',date '2026-06-01')
--   ); -- cascades checklist/events/studio links
-- update public.user_preferences
-- set app_settings=app_settings-'demo_marker'-'reminders'-'dashboard_activity', updated_at=now()
-- where user_id=(select user_id from public.artists_db where lower(username)='isainazartattoo.wo')
--   and app_settings->>'demo_marker'='[PRUEBA][DASHBOARD-ISAINAZ-20260829]';
-- update public.artists_db
-- set dashboard_config=coalesce(dashboard_config,'{}'::jsonb)
--   -'dashboard_demo_marker'-'dashboard_demo_quote_ids'
--   -'dashboard_demo_design_quote_ids'-'dashboard_design_progress'
-- where lower(username)='isainazartattoo.wo';
