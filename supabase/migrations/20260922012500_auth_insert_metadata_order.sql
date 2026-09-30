-- Auth applies app_metadata after its INSERT trigger. The draft marker in
-- user_metadata only suppresses automatic creation of the caller's own empty
-- artist profile; final registration still validates the server-owned draft.
do $$ declare definition text; begin
 select pg_get_functiondef('public.handle_new_user()'::regprocedure) into definition;
 definition := replace(definition, 'nullif(new.raw_app_meta_data->>''registration_draft_id'', '''')', 'nullif(new.raw_user_meta_data->>''registration_draft_id'', '''')');
 definition := replace(definition, 'WHERE client_user_id IS NULL AND', 'WHERE client_user_id IS NULL AND new.email_confirmed_at IS NOT NULL AND coalesce(new.raw_user_meta_data->>''qa_unverified_email'', ''false'') <> ''true'' AND');
 execute definition;
end $$;
