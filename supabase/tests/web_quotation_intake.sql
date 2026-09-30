begin;
set local role service_role;
do $$
declare
  k text := 'QN' || md5(random()::text || clock_timestamp()::text);
  result jsonb;
begin
  perform save_web_quotation(jsonb_build_object('quote_id',k,'quote_status','in_progress','client_full_name','QA rollback'),'{"idea_mode":"idea","reference_notes":[]}'::jsonb);
  result := save_web_quotation(jsonb_build_object('quote_id',k,'quote_status','pending','client_full_name','QA final'),'{"idea_mode":"idea","personalization_level":"interpretacion","reference_notes":["nota"]}'::jsonb);
  if result->>'status' <> 'pending' then raise exception 'Not submitted'; end if;
  perform save_web_quotation(jsonb_build_object('quote_id',k,'quote_status','in_progress','client_full_name','Late autosave'),'{"idea_mode":"explorar","reference_notes":[]}'::jsonb);
  perform save_web_quotation(jsonb_build_object('quote_id',k,'quote_status','pending','client_full_name','Duplicate request'),'{"idea_mode":"idea","reference_notes":[]}'::jsonb);
  if (select count(*) from quotations_db where quote_id=k) <> 1 then raise exception 'Duplicated quote'; end if;
  if not exists(select 1 from quotations_db where quote_id=k and quote_status='pending' and client_full_name='QA final') then raise exception 'Submitted quote changed'; end if;
  if not exists(select 1 from quotation_intake_extras where quote_id=k and personalization_level='interpretacion') then raise exception 'Lost extras'; end if;
  k := 'QN' || md5(random()::text || clock_timestamp()::text);
  begin
    perform save_web_quotation(jsonb_build_object('quote_id',k,'quote_status','pending'),'{"idea_mode":"invalid"}'::jsonb);
    raise exception 'Invalid extras accepted';
  exception when check_violation then null;
  end;
  if exists(select 1 from quotations_db where quote_id=k) then raise exception 'Partial parent persisted'; end if;
end $$;
rollback;
select not has_function_privilege('anon','public.save_web_quotation(jsonb,jsonb)','execute') as anon_denied,
       not has_function_privilege('authenticated','public.save_web_quotation(jsonb,jsonb)','execute') as authenticated_denied;
