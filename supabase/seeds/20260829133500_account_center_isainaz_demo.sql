-- Dataset idempotente del Centro de Cuenta para isainazartattoo.wo.
-- No contiene numeros de tarjeta, CVV, secretos OAuth ni tokens reutilizables.
do $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from public.artists_db
  where lower(username) = 'isainazartattoo.wo'
  limit 1;

  if v_user_id is null then
    raise notice 'account-center demo: isainazartattoo.wo no existe; seed omitido';
    return;
  end if;

  insert into public.artist_billing_profiles (artist_user_id, legal_name, tax_id)
  values (v_user_id, 'Isaí Nazar Tattoo', '20-34882119-7')
  on conflict (artist_user_id) do update set
    legal_name = excluded.legal_name,
    tax_id = excluded.tax_id;

  insert into public.artist_payment_methods
    (artist_user_id, provider, method_type, provider_reference, display_name, brand, last_four, account_hint, is_default, active, metadata_json)
  values
    (v_user_id, 'stripe', 'card_token', 'demo_pm_isainaz_4242', 'Visa terminada en 4242', 'Visa', '4242', 'Vence 08/28', false, true, '{"environment":"demo"}'),
    (v_user_id, 'mercado_pago', 'wallet', 'demo_mp_isainaz', 'Mercado Pago', null, null, 'isainazartattoo@demo.invalid', false, true, '{"environment":"demo"}'),
    (v_user_id, 'paypal', 'wallet', 'demo_pp_isainaz', 'PayPal', null, null, 'isainazartattoo@demo.invalid', false, true, '{"environment":"demo"}'),
    (v_user_id, 'wise', 'bank_account_token', 'demo_wise_isainaz_9931', 'Wise (transferencia internacional)', null, '9931', 'IBAN terminado en 9931', false, true, '{"environment":"demo"}')
  on conflict (artist_user_id, provider, provider_reference) do update set
    display_name = excluded.display_name,
    brand = excluded.brand,
    last_four = excluded.last_four,
    account_hint = excluded.account_hint,
    is_default = excluded.is_default,
    active = excluded.active,
    metadata_json = excluded.metadata_json;

  update public.artist_payment_methods method
  set is_default = true
  where method.artist_user_id = v_user_id
    and method.provider = 'stripe'
    and method.provider_reference = 'demo_pm_isainaz_4242'
    and not exists (
      select 1 from public.artist_payment_methods other
      where other.artist_user_id = v_user_id
        and other.active
        and other.is_default
        and other.id <> method.id
    );

  insert into public.artist_financial_entries
    (artist_user_id, entry_type, title, amount, currency, status, occurred_at, external_reference, metadata_json)
  values
    (v_user_id, 'income', 'Reserva confirmada — Camila Ortiz', 400, 'USD', 'completed', '2026-08-27 14:00:00+00', 'acct-demo-ledger-01', '{"source":"quotation"}'),
    (v_user_id, 'payout', 'Retiro a Mercado Pago', -900, 'USD', 'completed', '2026-08-20 17:00:00+00', 'acct-demo-ledger-02', '{"source":"payout"}'),
    (v_user_id, 'income', 'Guest spot — Costa Ink Collective', 1200, 'USD', 'completed', '2026-08-15 12:00:00+00', 'acct-demo-ledger-03', '{"source":"spot"}'),
    (v_user_id, 'fee', 'Comisión We Ötzi', -60, 'USD', 'completed', '2026-08-15 12:01:00+00', 'acct-demo-ledger-04', '{"source":"platform_fee"}'),
    (v_user_id, 'income', 'Reserva confirmada — Rodrigo A.', 220, 'USD', 'completed', '2026-08-10 18:00:00+00', 'acct-demo-ledger-05', '{"source":"quotation"}'),
    (v_user_id, 'payout', 'Próximo pago programado', -1240, 'USD', 'pending', '2026-09-05 12:00:00+00', 'acct-demo-ledger-06', '{"source":"payout"}'),
    (v_user_id, 'income', 'Ingresos del mes consolidados', 2030, 'USD', 'completed', '2026-08-29 10:00:00+00', 'acct-demo-ledger-07', '{"source":"account_summary","summary_only":true}')
  on conflict (artist_user_id, external_reference) do update set
    entry_type = excluded.entry_type,
    title = excluded.title,
    amount = excluded.amount,
    currency = excluded.currency,
    status = excluded.status,
    occurred_at = excluded.occurred_at,
    metadata_json = excluded.metadata_json;

  insert into public.artist_account_sessions
    (artist_user_id, auth_session_id, device_name, browser, operating_system, city, country, first_seen_at, last_seen_at)
  values
    (v_user_id, '9eebc8a4-304a-4ea1-a807-5182ae1c62c1', 'MacBook Pro — Chrome', 'Chrome', 'macOS', 'Buenos Aires', 'AR', '2026-08-29 11:00:00+00', '2026-08-29 11:00:00+00'),
    (v_user_id, 'a82a4821-6542-4d0f-8afc-8942710afdd8', 'iPhone 15 — App We Ötzi', 'App We Ötzi', 'iOS', 'Buenos Aires', 'AR', '2026-08-29 09:00:00+00', '2026-08-29 09:00:00+00'),
    (v_user_id, '65473c29-62df-4806-8fc2-d0d41d7dc99d', 'iPad Air — Safari', 'Safari', 'iPadOS', 'Córdoba', 'AR', '2026-08-24 16:00:00+00', '2026-08-24 16:00:00+00')
  on conflict (artist_user_id, auth_session_id) do update set
    device_name = excluded.device_name,
    browser = excluded.browser,
    operating_system = excluded.operating_system,
    city = excluded.city,
    country = excluded.country,
    last_seen_at = excluded.last_seen_at,
    revoked_at = null,
    revoke_reason = null;

  insert into public.artist_integration_connections
    (artist_user_id, provider, status, account_label, provider_reference, scopes, connected_at, metadata_json)
  values
    (v_user_id, 'google_calendar', 'connected', 'Calendario principal', 'demo_google_calendar_isainaz', array['calendar.readonly'], '2026-08-01 12:00:00+00', '{"environment":"demo"}'),
    (v_user_id, 'instagram', 'connected', '@isainazartattoo.wo', 'demo_instagram_isainaz', array['portfolio.import'], '2026-08-01 12:00:00+00', '{"environment":"demo"}'),
    (v_user_id, 'stripe', 'disconnected', null, null, '{}', null, '{"environment":"demo"}'),
    (v_user_id, 'whatsapp_business', 'disconnected', null, null, '{}', null, '{"environment":"demo"}')
  on conflict (artist_user_id, provider) do update set
    status = excluded.status,
    account_label = excluded.account_label,
    provider_reference = excluded.provider_reference,
    scopes = excluded.scopes,
    connected_at = excluded.connected_at,
    metadata_json = excluded.metadata_json;

  insert into public.user_preferences (user_id, notification_prefs, privacy, app_settings)
  values (
    v_user_id,
    '{"mensajes":{"email":true,"push":true,"sms":false},"cotizaciones":{"email":true,"push":true,"sms":true},"invitaciones":{"email":true,"push":true,"sms":false},"spots":{"email":true,"push":false,"sms":false},"job_board":{"email":false,"push":true,"sms":false},"calendario":{"email":true,"push":true,"sms":false},"promociones":{"email":false,"push":false,"sms":false}}',
    '{"show_city":true,"show_rating":true,"show_socials":true,"allow_search_indexing":false}',
    '{"timezone":"America/Argentina/Buenos_Aires","date_format":"DD/MM/AAAA","time_format":"24h","language":"es","country":"Argentina","city":"Buenos Aires","theme":"system","density":"comfortable","text_size":"medium","animations":true,"start_page":"dashboard","confirm_logout":true,"reduce_motion":false,"high_contrast":false,"interface_scale":"100","display_name":"artistic","page_size":"25","default_sort":"recent","availability":{"weekly":[{"day":"lunes","enabled":true,"start":"10:00","end":"19:00"},{"day":"martes","enabled":true,"start":"10:00","end":"19:00"},{"day":"miercoles","enabled":true,"start":"10:00","end":"19:00"},{"day":"jueves","enabled":true,"start":"10:00","end":"19:00"},{"day":"viernes","enabled":true,"start":"10:00","end":"19:00"},{"day":"sabado","enabled":false,"start":"10:00","end":"19:00"},{"day":"domingo","enabled":false,"start":"10:00","end":"19:00"}]}}'
  )
  on conflict (user_id) do update set
    notification_prefs = excluded.notification_prefs,
    privacy = excluded.privacy,
    app_settings = public.user_preferences.app_settings || excluded.app_settings;
end $$;
