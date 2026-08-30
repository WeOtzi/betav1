-- Exact opportunity surfaces for @isainazartattoo.wo.
-- Figma: Job Board, Spots, Mis postulaciones and Invitaciones.
-- Marker by natural keys: JB-FIGMA-*, studio slugs below and exact spot titles.

begin;

-- Never attach demo opportunity data to a real studio account. Failing fast
-- keeps the whole transaction atomic; every downstream resolver repeats the
-- ownerless predicate as defense in depth against concurrent ownership changes.
do $$
declare
  v_owned_slugs text;
begin
  select string_agg(s.slug, ', ' order by s.slug)
  into v_owned_slugs
  from public.studios s
  where s.slug in (
    'costa-ink-collective','palermo-tattoo-club','bang-bang-nyc','sur-tattoo-house',
    'linea-fina-studio','estudio-lisboa-sur','estudio-bauhaus-ink','geometria-negra',
    'nordic-line-studio','casa-ro-tattoo','bariloche-ink','mendoza-tattoo-lab',
    'fierro-negro-tattoo','casa-aguja','zorro-rojo-tattoo','estudio-cactus','tierra-firme-tattoo'
  )
    and s.user_id is not null;

  if v_owned_slugs is not null then
    raise exception 'Opportunity demo seed aborted: owned studio slug collision(s): %', v_owned_slugs
      using errcode = '23505';
  end if;
end
$$;

-- Feed fixtures use dedicated internal request codes and the existing demo
-- client. Never overwrite a request if one of those codes belongs to anyone
-- else; client_user_id is intentionally NOT NULL in the production schema.
do $$
declare
  v_demo_owner uuid;
  v_owned_request_codes text;
begin
  select c.user_id into v_demo_owner
  from public.clients_db c
  where lower(c.email) = 'demo-client1@weotzi.test'
  limit 1;

  if v_demo_owner is null then
    raise exception 'Opportunity demo seed aborted: demo Job Board owner is missing.'
      using errcode = '23503';
  end if;

  select string_agg(r.request_code, ', ' order by r.request_code)
  into v_owned_request_codes
  from public.job_board_requests r
  where r.request_code in (
    'JB-FIGMA-FEED-59407','JB-FIGMA-FEED-76217','JB-FIGMA-FEED-33005',
    'JB-FIGMA-FEED-34654','JB-FIGMA-FEED-28471','JB-FIGMA-FEED-51027',
    'JB-FIGMA-FEED-24872',
    'JB-FIGMA-FEED-45210','JB-FIGMA-FEED-30991','JB-FIGMA-FEED-41432',
    'JB-FIGMA-FEED-19832','JB-FIGMA-FEED-38820','JB-FIGMA-FEED-27654'
  )
    and r.client_user_id is distinct from v_demo_owner;

  if v_owned_request_codes is not null then
    raise exception 'Opportunity demo seed aborted: owned Job Board request collision(s): %',
      v_owned_request_codes
      using errcode = '23505';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Studios and one primary location each. Existing ownerless demo studios are
-- refreshed; owned studio profiles are never overwritten.
-- ---------------------------------------------------------------------------
with seed(name, normalized_name, slug, city, country, tagline, bio, cover_image, instagram, website) as (
  values
    ('Costa Ink Collective','costa ink collective','costa-ink-collective','Barcelona','España','Residencia de realismo, black & grey y fine line.','Estudio boutique en el barrio de Gràcia especializado en realismo y black & grey. Espacio compartido con dos artistas residentes, luz natural y clientela recurrente de proyectos grandes.',null,'costainkcollective','https://costainkcollective.com'),
    ('Palermo Tattoo Club','palermo tattoo club','palermo-tattoo-club','Buenos Aires','Argentina','Guest spots en el corazón de Palermo.','Cupo guest para blackwork y dotwork en el corazón de Palermo. Clientela propia más agenda compartida con el estudio.',null,'palermotattooclub','https://palermotattooclub.com'),
    ('Bang Bang NYC','bang bang nyc','bang-bang-nyc','New York','Estados Unidos','Residencia en New York.','Residencia larga en uno de los estudios más reconocidos de NYC. Incluye stipend mensual y mentoría.','/shared/assets/figma/opportunities/spots-studio-01.png','bangbangnyc','https://bangbangnyc.com'),
    ('Sur Tattoo House','sur tattoo house','sur-tattoo-house','Rosario','Argentina','Última oportunidad en Rosario.','Guest spot de dos semanas para artistas de blackwork.',null,'surtattoohouse',null),
    ('Línea Fina Studio','linea fina studio','linea-fina-studio','Villa Crespo','Argentina','Itinerante · Buenos Aires.','Espacio para fine line, blackwork y minimalismo.',null,'lineafinastudio',null),
    ('Estudio Lisboa Sur','estudio lisboa sur','estudio-lisboa-sur','Lisboa','Portugal','Residencia patrocinada en Lisboa.','Estudio con ambiente creativo en el corazón de Lisboa. Alojamiento incluido.',null,'lisboasur',null),
    ('Estudio Bauhaus Ink','estudio bauhaus ink','estudio-bauhaus-ink','Berlín','Alemania','Residencia de seis meses.','Estudio contemporáneo con stipend y espacio propio.',null,'bauhausink',null),
    ('Geometría Negra','geometria negra','geometria-negra','Córdoba','Argentina','Guest spot de geometría y dotwork.','Dos semanas en Córdoba para especialistas geométricos.',null,'geometrianegra',null),
    ('Nordic Line Studio','nordic line studio','nordic-line-studio','Oslo','Noruega','Residencia en Oslo.','Residencia de cuatro meses con stipend.',null,'nordiclinestudio',null),
    ('Casa Rö Tattoo','casa ro tattoo','casa-ro-tattoo','Ciudad de México','México','Guest spot en CDMX.','Oportunidad para artistas invitados.',null,'casarotattoo',null),
    ('Bariloche Ink','bariloche ink','bariloche-ink','Bariloche','Argentina','Guest spot en Patagonia.','Oportunidad para artistas invitados.',null,'barilocheink',null),
    ('Mendoza Tattoo Lab','mendoza tattoo lab','mendoza-tattoo-lab','Mendoza','Argentina','Guest spot en Mendoza.','Oportunidad para artistas invitados.',null,'mendozatatt451',null),
    ('Fierro Negro Tattoo','fierro negro tattoo','fierro-negro-tattoo','Buenos Aires','Argentina','Blackwork y dotwork en Palermo.','Estudio de blackwork y dotwork en Palermo, con seis años de trayectoria y roster estable de tres artistas. Ambiente under, agenda propia y fuerte presencia en redes.','/shared/assets/figma/opportunities/invitation-bang-bang.jpeg','fierronegro.tattoo','https://fierronegrotattoo.com'),
    ('Casa Aguja','casa aguja','casa-aguja','Córdoba','Argentina','Fine line y ornamental.','Casa de tatuaje contemporáneo en Córdoba.',null,'casaaguja',null),
    ('Zorro Rojo Tattoo','zorro rojo tattoo','zorro-rojo-tattoo','Barcelona','España','Realismo y black & grey.','Estudio de artistas residentes en Barcelona.',null,'zorrorojo',null),
    ('Estudio Cactus','estudio cactus','estudio-cactus','Ciudad de México','México','Old school y color.','Estudio de color y old school en Ciudad de México.',null,'estudiocactus',null),
    ('Tierra Firme Tattoo','tierra firme tattoo','tierra-firme-tattoo','Santiago','Chile','Dotwork y geométrico.','Colectivo de dotwork y estilo geométrico.',null,'tierrafirmetattoo',null)
)
insert into public.studios (
  name, normalized_name, slug, city, country, tagline, bio, cover_image,
  instagram, website, is_active, profile_complete, is_seeking_artists, updated_at
)
select name, normalized_name, slug, city, country, tagline, bio, cover_image,
       instagram, website, true, true, true, now()
from seed
on conflict (slug) do update set
  name = excluded.name,
  city = excluded.city,
  country = excluded.country,
  tagline = excluded.tagline,
  bio = excluded.bio,
  cover_image = excluded.cover_image,
  instagram = excluded.instagram,
  website = excluded.website,
  is_active = true,
  profile_complete = true,
  is_seeking_artists = true,
  updated_at = now()
where public.studios.user_id is null;

with seed(slug, city, country) as (
  values
    ('costa-ink-collective','Barcelona','España'),('palermo-tattoo-club','Buenos Aires','Argentina'),
    ('bang-bang-nyc','New York','Estados Unidos'),('sur-tattoo-house','Rosario','Argentina'),
    ('linea-fina-studio','Villa Crespo','Argentina'),('estudio-lisboa-sur','Lisboa','Portugal'),
    ('estudio-bauhaus-ink','Berlín','Alemania'),('geometria-negra','Córdoba','Argentina'),
    ('nordic-line-studio','Oslo','Noruega'),('casa-ro-tattoo','Ciudad de México','México'),
    ('bariloche-ink','Bariloche','Argentina'),('mendoza-tattoo-lab','Mendoza','Argentina'),
    ('fierro-negro-tattoo','Buenos Aires','Argentina'),('casa-aguja','Córdoba','Argentina'),
    ('zorro-rojo-tattoo','Barcelona','España'),('estudio-cactus','Ciudad de México','México'),
    ('tierra-firme-tattoo','Santiago','Chile')
)
insert into public.studio_locations (
  studio_id, label, is_primary, is_active, sort_order, city, country,
  formatted_address, updated_at
)
select s.id, 'Principal', true, true, 0, v.city, v.country,
       concat(v.city, ', ', v.country), now()
from seed v join public.studios s using (slug)
where s.user_id is null
  and not exists (
  select 1 from public.studio_locations l
  where l.studio_id = s.id and lower(coalesce(l.city,'')) = lower(v.city)
);

update public.studios s
set primary_location_id = (
      select l.id from public.studio_locations l
      where l.studio_id = s.id and l.is_active = true
      order by l.is_primary desc, l.sort_order, l.created_at
      limit 1
    ),
    updated_at = now()
where s.user_id is null
  and s.slug in (
  'costa-ink-collective','palermo-tattoo-club','bang-bang-nyc','sur-tattoo-house',
  'linea-fina-studio','estudio-lisboa-sur','estudio-bauhaus-ink','geometria-negra',
  'nordic-line-studio','casa-ro-tattoo','bariloche-ink','mendoza-tattoo-lab',
  'fierro-negro-tattoo','casa-aguja','zorro-rojo-tattoo','estudio-cactus','tierra-firme-tattoo'
);

-- ---------------------------------------------------------------------------
-- Spots directory. Two rows are persistently featured (rank 1 hero, rank 2
-- vertical promo); all other cards remain organic.
-- ---------------------------------------------------------------------------
update public.studio_spots sp
set title = case
      when s.slug='palermo-tattoo-club' then 'Guest spot · Buenos Aires · 4 semanas'
      when s.slug='bang-bang-nyc' then 'Residencia · New York · 3 a 6 meses'
      else sp.title end,
    status = case when s.slug in ('palermo-tattoo-club','bang-bang-nyc') then 'open' else sp.status end,
    updated_at = now()
from public.studios s
where s.id = sp.studio_id
  and s.user_id is null
  and sp.title in ('Guest spot · Buenos Aires · 4 semanas','Residency · NYC · 3 a 6 meses');

with seed(
  slug,title,kind,description,styles,languages,experience,housing,split,stipend,currency,frequency,
  weeks_min,weeks_max,start_date,end_date,expires_at,cover_image,is_featured,featured_rank,directory_rank,
  studio_includes,artist_expectations,minimum_requirements,contact_name,contact_title,response_sla
) as (
  values
    ('costa-ink-collective','Residencia · Barcelona · 3 a 6 meses','resident','Buscamos artista con foco en realismo y buen manejo del contraste. Estudio equipado y agenda garantizada desde el primer día.',array['Realismo','Black & Grey','Fine Line'],array['Español','Inglés'],3,false,66::numeric,1000::numeric,'EUR','monthly',12,24,date '2026-09-01',date '2027-02-28',now()+interval '45 days',null,true,1,1,array['Camilla y estación de trabajo propia','Material de bioseguridad e insumos base','Difusión en redes del estudio','Agenda compartida con clientela del estudio'],array['Portfolio con foco en realismo o black & grey','Disponibilidad mínima de 3 meses','Buen manejo de clientes propios y del estudio'],array['Mínimo 3 años de experiencia profesional','Certificado de bioseguridad vigente','Seguro de responsabilidad civil (o tramitarlo antes de llegar)'],'Marta Vidal','Coordinadora de artistas','24–72 horas'),
    ('palermo-tattoo-club','Guest spot · Buenos Aires · 4 semanas','guest_spot','Cupo guest para blackwork y dotwork en el corazón de Palermo. Clientela propia más agenda compartida con el estudio.',array['Blackwork','Dotwork','Tradicional'],array['Español'],2,false,68::numeric,null,null,null,4,4,date '2026-09-01',date '2026-09-28',now()+interval '3 days',null,false,null,2,array['Cabina equipada','Materiales incluidos'],array['Agenda disponible cuatro días por semana'],array['Portfolio activo','Mínimo 2 años de experiencia'],'Lucía Pérez','Studio manager','24–48 horas'),
    ('bang-bang-nyc','Residencia · New York · 3 a 6 meses','resident','Residencia larga en uno de los estudios más reconocidos de NYC. Incluye stipend mensual y mentoría.',array['Realismo','Black and grey','Fine line'],array['Inglés'],3,true,70::numeric,800::numeric,'USD','monthly',12,24,date '2026-10-01',date '2027-03-31',now()+interval '20 days','/shared/assets/figma/opportunities/spots-studio-01.png',false,null,3,array['Estación propia','Mentoría con artistas senior'],array['Disponibilidad de tres meses'],array['Inglés profesional','Portfolio de realismo'],'James Cole','Artist liaison','24–72 horas'),
    ('sur-tattoo-house','Guest spot · Rosario · última oportunidad','guest_spot','Última oportunidad para sumarte a Sur Tattoo House.',array['Blackwork','Dotwork'],array['Español'],2,false,65::numeric,null,null,null,2,2,date '2026-09-05',date '2026-09-19',now()+interval '2 days',null,false,null,4,array['Cabina equipada'],array['Dos semanas completas'],array['Portfolio de blackwork'],'María Sur','Fundadora','24–48 horas'),
    ('linea-fina-studio','Itinerante · Villa Crespo · 2 semanas','itinerant','Espacio itinerante para fine line, blackwork y minimalismo.',array['Fine Line','Blackwork','Minimalista'],array['Español'],2,false,65::numeric,null,null,null,2,2,date '2026-09-10',date '2026-09-24',now()+interval '5 days',null,false,null,5,array['Estación compartida'],array['Agenda flexible'],array['Portfolio fine line'],'Ana Línea','Coordinadora','24–72 horas'),
    ('estudio-lisboa-sur','Residencia · Lisboa · 3 a 5 meses','resident','Estudio con ambiente creativo en el corazón de Lisboa. Alojamiento incluido.',array['Blackwork','Ornamental'],array['Portugués','Inglés'],3,true,70::numeric,900::numeric,'EUR','monthly',12,20,date '2026-10-01',date '2027-02-28',now()+interval '90 days',null,true,2,6,array['Alojamiento','Estación propia','Agenda compartida'],array['Disponibilidad mínima de 3 meses'],array['Portfolio profesional'],'Inês Rocha','Residency manager','24–72 horas'),
    ('estudio-bauhaus-ink','Residencia · Berlín · 6 meses','resident','Residencia de seis meses en Berlín.',array['Geométrico','Blackwork'],array['Inglés'],3,true,65::numeric,1200::numeric,'EUR','monthly',24,24,date '2026-11-01',date '2027-04-30',now()+interval '60 days',null,false,null,7,array['Estación propia'],array['Seis meses de disponibilidad'],array['Portfolio geométrico'],'Lena Vogel','Studio manager','48–72 horas'),
    ('costa-ink-collective','Residencia corta · Barcelona · 3 semanas','resident','Residencia corta para artistas invitados.',array['Realismo','Fine Line'],array['Español','Inglés'],3,false,66::numeric,null,null,null,3,3,date '2026-10-05',date '2026-10-26',now()+interval '30 days',null,false,null,8,array['Estación propia'],array['Tres semanas completas'],array['Portfolio profesional'],'Marta Vidal','Coordinadora de artistas','24–72 horas'),
    ('geometria-negra','Guest spot · Córdoba · 2 semanas','guest_spot','Guest spot de geometría y dotwork en Córdoba.',array['Geométrico','Dotwork'],array['Español'],2,false,70::numeric,null,null,null,2,2,date '2026-09-15',date '2026-09-29',now()+interval '25 days',null,false,null,9,array['Cabina equipada'],array['Dos semanas completas'],array['Portfolio geométrico'],'Nora Díaz','Fundadora','24–48 horas'),
    ('nordic-line-studio','Residencia · Oslo · 4 meses','resident','Residencia de cuatro meses con stipend.',array['Fine Line','Minimalista'],array['Inglés'],3,true,65::numeric,900::numeric,'EUR','monthly',16,16,date '2026-11-01',date '2027-02-28',now()+interval '80 days',null,false,null,10,array['Alojamiento parcial','Estación propia'],array['Cuatro meses de disponibilidad'],array['Inglés profesional'],'Erik Lund','Residency manager','48–72 horas'),
    ('casa-ro-tattoo','Guest spot · Ciudad de México','guest_spot','Guest spot abierto en Ciudad de México.',array['Old school','Color'],array['Español'],2,false,60::numeric,null,null,null,2,4,date '2026-10-01',date '2026-10-31',now()+interval '4 days',null,false,null,11,array[]::text[],array[]::text[],array[]::text[],'Rocío Méndez','Studio manager','24–72 horas'),
    ('bariloche-ink','Guest spot · Bariloche','guest_spot','Guest spot abierto en Bariloche.',array['Blackwork'],array['Español'],2,false,65::numeric,null,null,null,2,3,date '2026-10-01',date '2026-10-21',now()+interval '25 days',null,false,null,12,array[]::text[],array[]::text[],array[]::text[],'Tomás Sur','Fundador','24–72 horas'),
    ('mendoza-tattoo-lab','Guest spot · Mendoza','guest_spot','Guest spot abierto en Mendoza.',array['Realismo'],array['Español'],2,false,65::numeric,null,null,null,2,3,date '2026-10-01',date '2026-10-21',now()+interval '1 day',null,false,null,13,array[]::text[],array[]::text[],array[]::text[],'Sofía Paz','Coordinadora','24–48 horas')
), resolved as (
  select v.*, s.id as studio_id,
         (select l.id from public.studio_locations l where l.studio_id=s.id order by l.is_primary desc,l.sort_order,l.created_at limit 1) as location_id
  from seed v join public.studios s using(slug)
  where s.user_id is null
), updated as (
  update public.studio_spots sp set
    location_id=r.location_id, kind=r.kind, description=r.description,
    styles_wanted=r.styles, language_requirements=r.languages,
    experience_min_years=r.experience, includes_housing=r.housing,
    revenue_split_pct=r.split, stipend_amount=r.stipend,
    stipend_currency=r.currency, stipend_frequency=r.frequency,
    weeks_minimum=r.weeks_min, weeks_maximum=r.weeks_max,
    start_date=r.start_date, end_date=r.end_date, expires_at=r.expires_at,
    cover_image=r.cover_image, status='open', max_applications=20,
    is_featured=r.is_featured, featured_rank=r.featured_rank, directory_rank=r.directory_rank,
    studio_includes=r.studio_includes, artist_expectations=r.artist_expectations,
    minimum_requirements=r.minimum_requirements, contact_name=r.contact_name,
    contact_title=r.contact_title, response_sla_label=r.response_sla,
    updated_at=now()
  from resolved r
  where sp.studio_id=r.studio_id and sp.title=r.title
  returning sp.id
)
insert into public.studio_spots (
  studio_id,location_id,title,kind,description,styles_wanted,language_requirements,
  experience_min_years,includes_housing,revenue_split_pct,stipend_amount,
  stipend_currency,stipend_frequency,start_date,end_date,weeks_minimum,weeks_maximum,
  status,max_applications,expires_at,cover_image,is_featured,featured_rank,directory_rank,
  studio_includes,artist_expectations,minimum_requirements,contact_name,contact_title,
  response_sla_label,updated_at
)
select r.studio_id,r.location_id,r.title,r.kind,r.description,r.styles,r.languages,
       r.experience,r.housing,r.split,r.stipend,r.currency,r.frequency,r.start_date,
       r.end_date,r.weeks_min,r.weeks_max,'open',20,r.expires_at,r.cover_image,
       r.is_featured,r.featured_rank,r.directory_rank,r.studio_includes,r.artist_expectations,
       r.minimum_requirements,r.contact_name,r.contact_title,r.response_sla,now()
from resolved r
where not exists (
  select 1 from public.studio_spots sp
  where sp.studio_id=r.studio_id and sp.title=r.title
);

-- ---------------------------------------------------------------------------
-- Artist Spot applications and one studio counter-offer.
-- ---------------------------------------------------------------------------
with target as (
  select user_id from public.artists_db where lower(username)='isainazartattoo.wo'
), seed(slug,title,status,message,start_date,end_date,created_at) as (
  values
    ('costa-ink-collective','Residencia · Barcelona · 3 a 6 meses','shortlisted','Hola equipo, me encantaría sumarme a la residencia — vengo trabajando en realismo y black & grey hace 4 años y creo que encajo con la línea del estudio.',date '2026-09-15',date '2026-10-01',timestamptz '2026-07-10 16:20:00+00'),
    ('bang-bang-nyc','Residencia · New York · 3 a 6 meses','shortlisted','Me interesa la residencia y tengo disponibilidad completa. Trabajo en inglés y español.',date '2026-10-01',date '2026-12-31',timestamptz '2026-07-20 12:00:00+00'),
    ('palermo-tattoo-club','Guest spot · Buenos Aires · 4 semanas','accepted','Quiero sumarme al guest spot de Palermo.',date '2026-09-01',date '2026-09-29',timestamptz '2026-07-01 10:00:00+00'),
    ('sur-tattoo-house','Guest spot · Rosario · última oportunidad','rejected','Me gustaría participar del guest spot en Rosario.',date '2026-09-05',date '2026-09-19',timestamptz '2026-07-05 10:00:00+00')
)
insert into public.studio_spot_applications (
  spot_id,artist_user_id,message,portfolio_url,requested_dates,status,created_at,decided_at
)
select sp.id,t.user_id,v.message,'/artist/profile?artist=isainazartattoo.wo',
       daterange(v.start_date,v.end_date,'[)'),v.status,v.created_at,
       case when v.status in ('accepted','rejected') then v.created_at+interval '2 days' else null end
from seed v
join public.studios s on s.slug=v.slug and s.user_id is null
join public.studio_spots sp on sp.studio_id=s.id and sp.title=v.title
cross join target t
on conflict (spot_id,artist_user_id) do update set
  message=excluded.message,portfolio_url=excluded.portfolio_url,
  requested_dates=excluded.requested_dates,status=excluded.status,
  created_at=excluded.created_at,decided_at=excluded.decided_at;

insert into public.studio_spot_counter_offers (
  application_id,author_role,split_pct,proposed_start_date,proposed_end_date,note,status,created_at
)
select a.id,'studio',70,date '2026-09-15',date '2026-09-30',
       'El estudio no incluye alojamiento, pero ofrece 15% de descuento en materiales.',
       'pending',timestamptz '2026-07-20 12:00:00+00'
from public.studio_spot_applications a
join public.studio_spots sp on sp.id=a.spot_id
join public.studios s on s.id=sp.studio_id
where s.slug='costa-ink-collective'
  and s.user_id is null
  and sp.title='Residencia · Barcelona · 3 a 6 meses'
  and a.artist_user_id=(select user_id from public.artists_db where lower(username)='isainazartattoo.wo')
on conflict (application_id,author_role) where status='pending' do update set
  split_pct=excluded.split_pct,proposed_start_date=excluded.proposed_start_date,
  proposed_end_date=excluded.proposed_end_date,note=excluded.note,created_at=excluded.created_at;

-- ---------------------------------------------------------------------------
-- Job Board featured request, five application states and saved requests.
-- ---------------------------------------------------------------------------
with seed(
  request_code,client_email,display_title,client_name,idea,body_part,style_json,city,country,
  budget_min,budget_max,created_at,status,is_public,is_featured,featured_rank,
  sponsor_name,sponsor_description,featured_tags,featured_slots
) as (
  values
    ('JB-FIGMA-SPONSOR','demo-client1@weotzi.test','Buscamos artistas residentes para nueva sede en Ciudad de México','Aurora Ink Collective','Estudio boutique especializado en blackwork y fine line abre agenda para una residencia de 3 meses. Clientela propia, marketing incluido y flexibilidad de fechas.','A convenir','["Blackwork","Fine Line"]'::jsonb,'Ciudad de México','México',800,2500,now()-interval '3 hours','open',true,true,1,'Aurora Ink Collective','Estudio boutique especializado en blackwork y fine line abre agenda para una residencia de 3 meses. Clientela propia, marketing incluido y flexibilidad de fechas.',array['Agenda inmediata','Múltiples proyectos','Contratación frecuente'],3),
    ('JB-FIGMA-59407','demo-client2@weotzi.test','Calavera con auriculares y notas musicales, new school','Diego N.','Quiero una calavera con auriculares y notas musicales en estilo new school.','Hombro','["New School","Tradicional"]'::jsonb,'Medellín','Colombia',200,400,timestamptz '2026-07-22 10:00:00+00','open',true,false,null,null,null,array[]::text[],null),
    ('JB-FIGMA-24872','demo-client1@weotzi.test','Retrato realista de abuela en blanco y negro','Camila R.','Quiero un retrato realista en blanco y negro de mi abuela, basado en una foto de los años 70. Me gustaría que se note el detalle de su expresión y el pañuelo que llevaba puesto. Es mi primer tatuaje grande y busco un artista con experiencia real en retratos hiperrealistas.','Antebrazo','["Realismo","Black & Grey"]'::jsonb,'Santiago','Chile',300,600,timestamptz '2026-07-25 10:00:00+00','open',true,false,null,null,null,array[]::text[],null),
    ('JB-FIGMA-33085','demo-client3@weotzi.test','Mandala geométrico con simbolismo lunar','Rodrigo A.','Mandala geométrico con simbolismo lunar para antebrazo.','Antebrazo','["Geométrico","Mandala"]'::jsonb,'Bogotá','Colombia',150,300,timestamptz '2026-07-18 10:00:00+00','accepted',true,false,null,null,null,array[]::text[],null),
    ('JB-FIGMA-38820','demo-newclient3@weotzi.test','Tigre feroz en blackwork con detalle ornamental','Sofía L.','Tigre feroz en blackwork con detalle ornamental.','Pantorrilla','["Blackwork","Ornamental"]'::jsonb,'Medellín','Colombia',600,1000,timestamptz '2026-07-15 10:00:00+00','closed',true,false,null,null,null,array[]::text[],null),
    ('JB-FIGMA-27654','demo-newclient33@weotzi.test','Serpiente enroscada estilo japonés tradicional','Bruno T.','Serpiente enroscada estilo japonés tradicional.','Pierna','["Japonés","Tradicional"]'::jsonb,'CDMX','México',400,800,timestamptz '2026-07-02 10:00:00+00','expired',true,false,null,null,null,array[]::text[],null)
)
insert into public.job_board_requests (
  request_code,client_user_id,display_title,client_display_name,tattoo_body_part,
  tattoo_idea_description,tattoo_style,client_city,client_country,client_travel_willing,
  client_budget_min,client_budget_max,client_budget_currency,status,application_count,
  is_public,created_at,updated_at,expires_at,is_featured,featured_rank,sponsor_name,
  sponsor_description,featured_tags,featured_slots_count
)
select v.request_code,c.user_id,v.display_title,v.client_name,v.body_part,v.idea,v.style_json,
       v.city,v.country,true,v.budget_min,v.budget_max,'USD',v.status,0,v.is_public,
       v.created_at,now(),now()+interval '45 days',v.is_featured,v.featured_rank,
       v.sponsor_name,v.sponsor_description,v.featured_tags,v.featured_slots
from seed v join public.clients_db c on lower(c.email)=lower(v.client_email)
on conflict (request_code) do update set
  client_user_id=excluded.client_user_id,display_title=excluded.display_title,
  client_display_name=excluded.client_display_name,tattoo_body_part=excluded.tattoo_body_part,
  tattoo_idea_description=excluded.tattoo_idea_description,tattoo_style=excluded.tattoo_style,
  client_city=excluded.client_city,client_country=excluded.client_country,
  client_budget_min=excluded.client_budget_min,client_budget_max=excluded.client_budget_max,
  status=excluded.status,is_public=excluded.is_public,updated_at=now(),expires_at=excluded.expires_at,
  is_featured=excluded.is_featured,featured_rank=excluded.featured_rank,
  sponsor_name=excluded.sponsor_name,sponsor_description=excluded.sponsor_description,
  featured_tags=excluded.featured_tags,featured_slots_count=excluded.featured_slots_count;

-- Exact Figma feed cards. These fixtures intentionally use internal request
-- codes distinct from the application-state demos above.
with seed(
  request_code,display_code,feed_rank,display_title,styles,city,country,body_part,
  budget_min,budget_max,application_count,created_at
) as (
  values
    ('JB-FIGMA-FEED-59407','JB-59407',1,'Calavera con auriculares y notas musicales, estilo new school','["New School","Tradicional"]'::jsonb,'Medellín','Colombia','Hombro',200,400,4,now()-interval '1 day'),
    ('JB-FIGMA-FEED-76217','JB-76217',2,'Retrato de gato persa estilo anime con ojos grandes','["Anime","New School"]'::jsonb,'Lima','Perú','Antebrazo',100,250,1,now()-interval '2 days'),
    ('JB-FIGMA-FEED-33005','JB-33005',3,'Mandala geométrico con simbolismo lunar','["Geométrico","Mandala"]'::jsonb,'Bogotá','Colombia','Costilla',150,300,2,timestamptz '2026-08-12 10:00:00+00'),
    ('JB-FIGMA-FEED-34654','JB-34654',4,'Serpiente enroscada en estilo japonés tradicional','["Japonés","Tradicional"]'::jsonb,'CDMX','México','Pierna',400,800,6,timestamptz '2026-08-11 10:00:00+00'),
    ('JB-FIGMA-FEED-28471','JB-28471',5,'Brújula vintage con mapa náutico','["Tradicional","Lettering"]'::jsonb,'Rosario','Argentina','Pantorrilla',150,350,3,timestamptz '2026-08-10 10:00:00+00'),
    ('JB-FIGMA-FEED-51027','JB-51027',6,'Loro tropical con flores exóticas y colores vibrantes','["Realismo","Acuarela"]'::jsonb,'Quito','Ecuador','Antebrazo',200,500,4,timestamptz '2026-08-09 10:00:00+00'),
    ('JB-FIGMA-FEED-24872','JB-24872',7,'Retrato realista de abuela en blanco y negro','["Realismo","Black & Grey"]'::jsonb,'Santiago','Chile','Antebrazo',300,600,5,now()-interval '3 days'),
    ('JB-FIGMA-FEED-45210','JB-45210',8,'Retrato hiperrealista de lobo aullando bajo la luna','["Hiperrealismo","Realismo"]'::jsonb,'Montevideo','Uruguay','Pantorrilla',400,900,4,timestamptz '2026-08-08 10:00:00+00'),
    ('JB-FIGMA-FEED-30991','JB-30991',9,'Paisaje de montaña en acuarela realista','["Realismo","Acuarela"]'::jsonb,'Medellín','Colombia','Brazo',250,500,2,timestamptz '2026-08-07 10:00:00+00'),
    ('JB-FIGMA-FEED-41432','JB-41432',10,'Ángel caído con alas desplegadas y plumas cayendo','["Blackwork","Surrealista"]'::jsonb,'Lima','Perú','Espalda Alta',500,1000,3,timestamptz '2026-08-06 10:00:00+00'),
    ('JB-FIGMA-FEED-19832','JB-19832',11,'Tigre feroz en blackwork con detalle ornamental','["Blackwork","Ornamental"]'::jsonb,'Medellín','Colombia','Brazo completo',600,1200,7,timestamptz '2026-08-05 10:00:00+00'),
    ('JB-FIGMA-FEED-38820','JB-38820',12,'Cráneo ornamental con mandala en blackwork','["Blackwork","Ornamental"]'::jsonb,'Bogotá','Colombia','Pecho',500,900,5,timestamptz '2026-08-04 10:00:00+00'),
    ('JB-FIGMA-FEED-27654','JB-27654',13,'Fénix renaciendo entre líneas geométricas blackwork','["Blackwork","Geométrico"]'::jsonb,'Lima','Perú','Espalda',600,1100,6,timestamptz '2026-08-03 10:00:00+00')
), demo_owner as (
  select c.user_id
  from public.clients_db c
  where lower(c.email) = 'demo-client1@weotzi.test'
  limit 1
)
insert into public.job_board_requests (
  request_code,client_user_id,display_code,feed_rank,display_title,
  tattoo_body_part,tattoo_idea_description,tattoo_style,client_city,client_country,
  client_travel_willing,client_budget_min,client_budget_max,client_budget_currency,
  status,application_count,is_public,created_at,updated_at,expires_at,
  is_featured,featured_rank,sponsor_name,sponsor_description,featured_tags,
  featured_slots_count
)
select
  v.request_code,o.user_id,v.display_code,v.feed_rank,v.display_title,
  v.body_part,v.display_title,v.styles,v.city,v.country,
  true,v.budget_min,v.budget_max,'USD',
  'open',v.application_count,true,v.created_at,now(),timestamptz '2026-12-31 23:59:59+00',
  false,null,null,null,array[]::text[],null
from seed v cross join demo_owner o
on conflict (request_code) do update set
  display_code=excluded.display_code,feed_rank=excluded.feed_rank,
  display_title=excluded.display_title,tattoo_body_part=excluded.tattoo_body_part,
  tattoo_idea_description=excluded.tattoo_idea_description,tattoo_style=excluded.tattoo_style,
  client_city=excluded.client_city,client_country=excluded.client_country,
  client_travel_willing=excluded.client_travel_willing,
  client_budget_min=excluded.client_budget_min,client_budget_max=excluded.client_budget_max,
  client_budget_currency=excluded.client_budget_currency,status=excluded.status,
  application_count=excluded.application_count,is_public=excluded.is_public,
  created_at=excluded.created_at,updated_at=now(),expires_at=excluded.expires_at,
  is_featured=false,featured_rank=null,sponsor_name=null,sponsor_description=null,
  featured_tags=array[]::text[],featured_slots_count=null
where public.job_board_requests.client_user_id = excluded.client_user_id;

with target as (
  select user_id from public.artists_db where lower(username)='isainazartattoo.wo'
), seed(request_code,price,sessions,duration,status,message,created_at) as (
  values
    ('JB-FIGMA-59407','280 USD',2,'2_3_days','pending','Me interesa el proyecto y puedo resolverlo en dos sesiones.',timestamptz '2026-07-22 18:10:00+00'),
    ('JB-FIGMA-24872','450 USD',3,'2_3_days','viewed','Hola Camila, me encantaría hacer este retrato — trabajo hace 4 años con realismo en blanco y negro y tengo experiencia con este tipo de fotos antiguas. Te comparto mi portfolio.',timestamptz '2026-07-25 18:10:00+00'),
    ('JB-FIGMA-33085','220 USD',2,'2_3_days','accepted','Puedo resolver el mandala en dos sesiones.',timestamptz '2026-07-18 12:00:00+00'),
    ('JB-FIGMA-38820','900 USD',4,'1_week','rejected','Propuesta para el tigre blackwork.',timestamptz '2026-07-15 12:00:00+00'),
    ('JB-FIGMA-27654','600 USD',3,'1_week','pending','Propuesta para la serpiente japonesa.',timestamptz '2026-07-02 12:00:00+00')
)
insert into public.job_board_applications (
  request_id,artist_id,message,estimated_price,estimated_sessions,estimated_duration,
  availability_note,portfolio_links,status,created_at,updated_at,decided_at
)
select r.id,t.user_id,v.message,v.price,v.sessions,v.duration,'Disponible desde agosto',
       array['/artist/profile?artist=isainazartattoo.wo'],v.status,v.created_at,now(),
       case when v.status in ('accepted','rejected') then v.created_at+interval '2 days' else null end
from seed v join public.job_board_requests r using(request_code) cross join target t
on conflict (request_id,artist_id) do update set
  message=excluded.message,estimated_price=excluded.estimated_price,
  estimated_sessions=excluded.estimated_sessions,estimated_duration=excluded.estimated_duration,
  availability_note=excluded.availability_note,portfolio_links=excluded.portfolio_links,
  status=excluded.status,created_at=excluded.created_at,updated_at=now(),decided_at=excluded.decided_at;

insert into public.job_board_counter_offers (
  application_id,author_role,price,currency,proposed_date,note,status,created_at
)
select a.id,'client',400,'USD','Sin cambios de fecha propuestos',
       'El cliente propone resolverlo en una sola sesión si es posible.','pendiente',
       timestamptz '2026-07-27 12:00:00+00'
from public.job_board_applications a
join public.job_board_requests r on r.id=a.request_id
where r.request_code='JB-FIGMA-24872'
  and a.artist_id=(select user_id from public.artists_db where lower(username)='isainazartattoo.wo')
  and not exists (
    select 1 from public.job_board_counter_offers o
    where o.application_id=a.id and o.author_role='client' and o.status='pendiente'
  );

insert into public.artist_saved_job_requests (artist_user_id,request_id)
select a.user_id,r.id
from public.artists_db a
join public.job_board_requests r on r.request_code in ('JB-FIGMA-59407','JB-FIGMA-24872')
where lower(a.username)='isainazartattoo.wo'
on conflict (artist_user_id,request_id) do nothing;

-- ---------------------------------------------------------------------------
-- Invitations: 3 pending, 1 active and 1 rejected, with private detail rows.
-- ---------------------------------------------------------------------------
with target as (
  select user_id from public.artists_db where lower(username)='isainazartattoo.wo'
), seed(slug,role,status,split,invited_at,started_at,ended_at,notes,is_active) as (
  values
    ('fierro-negro-tattoo','resident','pending_acceptance',60::numeric,timestamptz '2026-07-12 12:00:00+00',null::timestamptz,null::timestamptz,'Vimos tu portfolio en el job board y creemos que encajás con la casa. Nos encantaría sumarte al roster.',false),
    ('casa-aguja','guest','pending_acceptance',50::numeric,timestamptz '2026-07-10 12:00:00+00',null,null,'Tu trabajo en fine line es justo lo que nos falta. 50/50 comisión, agenda gestionada.',false),
    ('zorro-rojo-tattoo','resident','active',65::numeric,timestamptz '2026-07-08 12:00:00+00',timestamptz '2026-08-01 12:00:00+00',null,'¡Bienvenido al equipo — arrancamos el 1 de agosto!',true),
    ('estudio-cactus','guest','rejected',60::numeric,timestamptz '2026-07-05 12:00:00+00',null,timestamptz '2026-07-06 12:00:00+00','Invitación para sumarte al roster de color.',false),
    ('tierra-firme-tattoo','guest','pending_acceptance',60::numeric,timestamptz '2026-07-02 12:00:00+00',null,null,'Armamos un colectivo de dotwork y tu estilo geométrico es perfecto.',false)
)
insert into public.studio_artist_memberships (
  studio_id,artist_user_id,location_id,role,revenue_split_pct,status,
  invited_at,started_at,ended_at,notes,updated_at
)
select s.id,t.user_id,s.primary_location_id,v.role,v.split,v.status,
       v.invited_at,v.started_at,v.ended_at,v.notes,now()
from seed v
join public.studios s on s.slug=v.slug and s.user_id is null
cross join target t
on conflict (studio_id,artist_user_id,role,status) do update set
  location_id=excluded.location_id,revenue_split_pct=excluded.revenue_split_pct,
  invited_at=excluded.invited_at,started_at=excluded.started_at,
  ended_at=excluded.ended_at,notes=excluded.notes,updated_at=now();

with seed(
  slug,role,status,is_featured,styles,response_due,proposed_start,duration_label,benefits,
  studio_provides,artist_expectations,requirements,acceptance_steps,
  contact_name,contact_email,contact_title,message
) as (
  values
    ('fierro-negro-tattoo','resident','pending_acceptance',true,array['Blackwork','Dotwork'],timestamptz '2026-08-03 23:59:00+00',date '2026-08-01','Indefinida — miembro estable del roster',array['Materiales incluidos','Piso mínimo garantizado'],array['Materiales e insumos de bioseguridad','Piso mínimo garantizado los primeros 3 meses','Difusión en redes del estudio','Agenda gestionada por recepción'],array['Disponibilidad de al menos 4 días por semana','Buen manejo de blackwork y dotwork','Compromiso con la agenda y los tiempos del estudio'],array['Portfolio activo en el Job Board','Mínimo 2 años de experiencia profesional','Residencia legal o permiso de trabajo en Argentina'],array['Coordinamos tu primera semana de agenda','Te sumamos al grupo del estudio','Firmamos el acuerdo de roster'],'Nico Ferro','nico@fierronegrotattoo.com','Fundador, Fierro Negro Tattoo','Vimos tu portfolio en el Job Board y creemos que encajás con la casa. Nos encantaría sumarte al roster.'),
    ('casa-aguja','guest','pending_acceptance',false,array['Fine Line','Ornamental'],timestamptz '2026-08-05 23:59:00+00',date '2026-09-01','3 meses',array['Agenda gestionada'],array['Estación compartida','Difusión en redes'],array['Tres días por semana'],array['Portfolio fine line'],array['Coordinamos agenda','Firmamos acuerdo'],'Mara Aguja','hola@casaaguja.test','Fundadora','Tu trabajo en fine line es justo lo que nos falta.'),
    ('zorro-rojo-tattoo','resident','active',false,array['Realismo','Black & Grey'],null,date '2026-08-01','Indefinida',array['Roster activo'],array['Estación propia'],array['Agenda estable'],array['Portfolio profesional'],array['Ya sos parte del roster'],'Juli Rojo','equipo@zorrorojo.test','Coordinadora','¡Bienvenido al equipo!'),
    ('estudio-cactus','guest','rejected',false,array['Old school','Color'],null,date '2026-08-15','2 meses',array[]::text[],array[]::text[],array[]::text[],array[]::text[],array[]::text[],'Eva Cactus','hola@estudiocactus.test','Fundadora','Invitación para sumarte al roster de color.'),
    ('tierra-firme-tattoo','guest','pending_acceptance',false,array['Dotwork','Geométrico'],timestamptz '2026-08-07 23:59:00+00',date '2026-09-15','4 meses',array['Materiales incluidos'],array['Estación propia'],array['Cuatro días por semana'],array['Portfolio geométrico'],array['Coordinamos agenda','Firmamos acuerdo'],'Tomás Firme','hola@tierrafirme.test','Fundador','Armamos un colectivo de dotwork y tu estilo geométrico es perfecto.')
), memberships as (
  select m.id as membership_id,v.*
  from seed v
  join public.studios s on s.slug=v.slug and s.user_id is null
  join public.studio_artist_memberships m
    on m.studio_id=s.id and m.status=v.status and m.role=v.role
  where m.artist_user_id=(select user_id from public.artists_db where lower(username)='isainazartattoo.wo')
)
insert into public.studio_membership_invitation_details (
  membership_id,is_featured,styles,response_due_at,proposed_start_date,duration_label,
  benefits,studio_provides,artist_expectations,requirements,acceptance_steps,
  contact_name,contact_email,contact_title,message,updated_at
)
select membership_id,is_featured,styles,response_due,proposed_start,duration_label,
       benefits,studio_provides,artist_expectations,requirements,acceptance_steps,
       contact_name,contact_email,contact_title,message,now()
from memberships
on conflict (membership_id) do update set
  is_featured=excluded.is_featured,styles=excluded.styles,response_due_at=excluded.response_due_at,
  proposed_start_date=excluded.proposed_start_date,duration_label=excluded.duration_label,
  benefits=excluded.benefits,studio_provides=excluded.studio_provides,
  artist_expectations=excluded.artist_expectations,requirements=excluded.requirements,
  acceptance_steps=excluded.acceptance_steps,contact_name=excluded.contact_name,
  contact_email=excluded.contact_email,contact_title=excluded.contact_title,
  message=excluded.message,updated_at=now();

commit;

-- Scoped rollback, if ever required:
-- delete from public.artist_saved_job_requests where request_id in (select id from public.job_board_requests where request_code like 'JB-FIGMA-%');
-- delete from public.job_board_requests where request_code like 'JB-FIGMA-%';
-- delete from public.studio_spots where title in (
--   'Residencia · Barcelona · 3 a 6 meses','Guest spot · Buenos Aires · 4 semanas',
--   'Residencia · New York · 3 a 6 meses','Guest spot · Rosario · última oportunidad',
--   'Itinerante · Villa Crespo · 2 semanas','Residencia · Lisboa · 3 a 5 meses',
--   'Residencia · Berlín · 6 meses','Residencia corta · Barcelona · 3 semanas',
--   'Guest spot · Córdoba · 2 semanas','Residencia · Oslo · 4 meses',
--   'Guest spot · Ciudad de México','Guest spot · Bariloche','Guest spot · Mendoza');
-- delete from public.studio_artist_memberships where artist_user_id=(select user_id from public.artists_db where lower(username)='isainazartattoo.wo') and studio_id in (select id from public.studios where slug in ('fierro-negro-tattoo','casa-aguja','zorro-rojo-tattoo','estudio-cactus','tierra-firme-tattoo'));
