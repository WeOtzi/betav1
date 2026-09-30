-- Dedicated disposable audit fixture. No real customer's rows are changed.
begin;
do $$ begin
 if not exists(select 1 from auth.users where id='aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b' and email='lalal3647+auditoria@gmail.com') then raise exception 'Audit identity mismatch'; end if;
end $$;
insert into public.artists_db(user_id,email,name,username,registration_status,registration_step,city,country,ubicacion,work_type,estudios,styles_array,estilo,years_experience,bio_description,session_price,session_price_amount,session_price_currency,gallery_images,profile_picture)
values('aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b','lalal3647+auditoria@gmail.com','Laura · Auditoría','laura-auditoria.wo','pendiente de validacion',12,'Buenos Aires','Argentina','Buenos Aires','independent','Estudio de prueba · Auditoría',array['Fine Line','Blackwork'],'Fine Line','3-5','[AUDITORÍA] Perfil de prueba para revisar diseño, navegación y funciones. Los trabajos y solicitudes son ejemplos ficticios.','200 USD',200,'USD','["/shared/assets/demo/ref-01.svg","/shared/assets/demo/ref-02.svg","/shared/assets/demo/ref-03.svg"]'::jsonb,'/shared/assets/demo/client-avatar.svg')
on conflict(user_id) do nothing;
insert into public.clients_db(user_id,email,full_name,city_residence,country,email_verified)
values('aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b','lalal3647+auditoria@gmail.com','Laura · Auditoría','Buenos Aires','Argentina',false)
on conflict(user_id) do update set city_residence=excluded.city_residence,country=excluded.country;

insert into public.quotations_db(quote_id,quote_status,artist_id,client_user_id,artist_name,artist_username,artist_email,client_full_name,client_email,tattoo_idea_description,tattoo_body_part,tattoo_size,tattoo_style,client_budget_amount,client_budget_currency,artist_budget_amount,artist_budget_currency,final_budget_amount,final_budget_currency,final_sessions,project_description,source,current_step,artist_completed_at,client_completed_at)
select 'LAURA-QA-'||n,status,'aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b'::uuid,'aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b'::uuid,'Laura · Auditoría','laura-auditoria.wo','lalal3647+auditoria@gmail.com','Cliente de prueba '||n,'lalal3647+auditoria@gmail.com','[AUDITORÍA] '||idea,'Antebrazo','Mediano','{"style_name":"Fine Line"}'::jsonb,'300','USD',case when n>1 then '250' end,'USD',case when n>2 then '250' end,'USD','2','[AUDITORÍA] '||idea,'direct',case when n=3 then 'BOCETO' end,case when n=4 then now()-interval '2 days' end,case when n=4 then now()-interval '1 day' end
from(values(1,'pending','Rama botánica: solicitud nueva'),(2,'responded','Mariposa: presupuesto para aceptar'),(3,'client_approved','Montaña geométrica: diseño y sesiones'),(4,'completed','Flor terminada: revisión y reseña'),(5,'client_rejected','Proyecto rechazado: estado alternativo')) s(n,status,idea)
on conflict(quote_id) do nothing;
insert into public.quotation_sessions(quotation_id,session_number,session_date,duration_hours,status,notes)
select q.id,s.n,date_trunc('day',now())+make_interval(days=>s.days,hours=>s.hour),2,s.status,'[AUDITORÍA] Sesión de ejemplo'
from public.quotations_db q cross join(values(1,0,15,'scheduled'),(2,7,15,'scheduled')) s(n,days,hour,status)
where q.quote_id='LAURA-QA-3' and not exists(select 1 from quotation_sessions x where x.quotation_id=q.id and x.session_number=s.n);
insert into public.artist_calendar_events(artist_user_id,event_type,title,starts_at,ends_at,status,notes)
select 'aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b',s.kind,s.title,date_trunc('day',now())+make_interval(days=>s.days,hours=>10),date_trunc('day',now())+make_interval(days=>s.days,hours=>12),'scheduled','[AUDITORÍA] Evento editable de prueba'
from(values('availability','[AUDITORÍA] Horario disponible',1),('personal','[AUDITORÍA] Revisar portfolio',2),('blocked_day','[AUDITORÍA] Bloqueo de agenda',3)) s(kind,title,days)
where not exists(select 1 from artist_calendar_events e where e.artist_user_id='aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b' and e.title=s.title);
insert into public.chat_messages(quotation_id,sender_type,sender_id,message,is_read)
select 'LAURA-QA-3',s.role,'aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b',s.message,false
from(values('client','[AUDITORÍA] Me gustaría una montaña con líneas finas.'),('artist','[AUDITORÍA] Preparé la propuesta. Podemos revisar tamaño y fecha en este chat.')) s(role,message)
where not exists(select 1 from chat_messages m where m.quotation_id='LAURA-QA-3' and m.message=s.message);
insert into public.job_board_requests(request_code,client_user_id,tattoo_idea_description,tattoo_body_part,tattoo_size,tattoo_style,client_city,client_country,client_budget_min,client_budget_max,status,is_public,display_title)
values('LAURA-QA-JOB','aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b','[AUDITORÍA] Publicación privada de prueba: composición botánica.','Antebrazo','Mediano','{"style_name":"Fine Line"}'::jsonb,'Buenos Aires','Argentina',200,400,'open',false,'[AUDITORÍA] Composición botánica') on conflict(request_code) do nothing;
insert into public.artist_trips(artist_user_id,city,country,start_date,end_date,trip_type,status,personal_notes)
select 'aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b','Córdoba','Argentina',current_date+14,current_date+18,'guest_spot','planificado','[AUDITORÍA] Viaje de ejemplo, sin acuerdos reales'
where not exists(select 1 from artist_trips where artist_user_id='aca5d0c3-9eaa-4cbb-8c83-6f479adbea6b' and personal_notes like '[AUDITORÍA]%');
commit;
