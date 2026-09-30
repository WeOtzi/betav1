-- Preserve the existing trigger, but let server-owned drafts supply the artist
-- profile, and never attach historical quotations based on an unverified test email.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.handle_new_user()'::regprocedure) into definition;
 if position('IF signup_type NOT IN (''client'', ''studio'') THEN' in definition)=0 then
   raise exception 'Unexpected handle_new_user definition; review before applying';
 end if;
 definition := replace(definition,
   'IF signup_type NOT IN (''client'', ''studio'') THEN',
   'IF signup_type NOT IN (''client'', ''studio'') AND nullif(new.raw_app_meta_data->>''registration_draft_id'', '''') IS NULL THEN');
 definition := replace(definition,
   'WHERE client_user_id IS NULL',
   'WHERE client_user_id IS NULL AND coalesce(new.raw_app_meta_data->>''qa_unverified_email'', ''false'') <> ''true''');
 execute definition;
end $$;
