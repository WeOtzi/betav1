-- Acceso · ACC-03 · limpieza de artistas "fantasma" creados por OAuth.
-- CORRER SOLO CON OK DEL DUEÑO (no es una migración).
--
-- Antes de 20261115100000, handle_new_user creaba una fila PÚBLICA en
-- artists_db ('pendiente de validacion') para todo usuario de Google/Facebook.
-- Si era un cliente, aparecía como artista vacío en el marketplace.
--
-- NUNCA BORRAR estas filas: trigger_delete_auth_on_artist_delete hace
-- DELETE FROM auth.users al borrar la fila del artista y se perdería la cuenta.
-- Se pasan a 'incompleto' (la RLS pública las oculta; si la persona era un
-- artista de verdad, /api/account/mode la manda a terminar el registro).
--
-- Paso 1 · revisar qué filas toca (sin cambios):
select a.user_id, a.email, a.name, a.registration_status, u.raw_app_meta_data->>'provider' as provider,
       (c.user_id is not null) as tiene_cliente
from public.artists_db a
join auth.users u on u.id = a.user_id
left join public.clients_db c on c.user_id = a.user_id
where coalesce(u.raw_app_meta_data->>'provider', 'email') <> 'email'
  and nullif(u.raw_user_meta_data->>'registration_draft_id', '') is null
  and coalesce(a.registration_status, '') <> 'incompleto'
  and coalesce(array_length(a.styles_array, 1), 0) = 0
  and nullif(trim(coalesce(a.portafolio, '')), '') is null;

-- Paso 2 · aplicar (dentro de una transacción, revisar el conteo y recién ahí commit):
-- begin;
-- update public.artists_db a
--    set registration_status = 'incompleto'
--   from auth.users u
--  where u.id = a.user_id
--    and coalesce(u.raw_app_meta_data->>'provider', 'email') <> 'email'
--    and nullif(u.raw_user_meta_data->>'registration_draft_id', '') is null
--    and coalesce(a.registration_status, '') <> 'incompleto'
--    and coalesce(array_length(a.styles_array, 1), 0) = 0
--    and nullif(trim(coalesce(a.portafolio, '')), '') is null;
-- commit;
