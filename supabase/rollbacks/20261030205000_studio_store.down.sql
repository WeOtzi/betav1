-- Rollback de 20261030205000_studio_store.sql: vuelve a las definiciones de
-- 20261030150000_store_core.sql y quita la venta en mostrador.

begin;

set local lock_timeout = '5s';

drop function if exists public.create_store_pos_order(uuid, uuid, uuid, integer, text, text, text, text, text);

create or replace function public.store_public_seller_bundle(p_seller_type text, p_seller_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seller jsonb;
  v_index boolean := false;
  v_settings public.store_seller_settings;
begin
  if p_seller_type = 'artist' then
    select jsonb_build_object(
             'type', 'artist',
             'id', a.user_id,
             'handle', a.username,
             'name', a.name,
             'avatar_url', a.profile_picture,
             'city', case when coalesce(up.privacy ->> 'show_city', '') = 'false' then null::text else a.city end,
             'country', a.country
           ),
           coalesce(up.privacy ->> 'allow_search_indexing', '') = 'true'
      into v_seller, v_index
      from public.artists_db a
      left join public.user_preferences up on up.user_id = a.user_id
     where a.user_id = p_seller_id
       and a.registration_status is distinct from 'incompleto'
     limit 1;
    if not found then
      return null;
    end if;
  elsif p_seller_type = 'studio' then
    select jsonb_build_object(
             'type', 'studio',
             'id', s.id,
             'handle', null::text,
             'name', s.name,
             'avatar_url', null::text,
             'city', null::text,
             'country', null::text
           )
      into v_seller
      from public.studios s
     where s.id = p_seller_id
     limit 1;
    if not found then
      return null;
    end if;
    v_index := false;
  else
    return null;
  end if;

  select * into v_settings
    from public.store_seller_settings ss
   where ss.seller_type = p_seller_type and ss.seller_id = p_seller_id;

  return jsonb_build_object(
    'seller', v_seller,
    'allow_search_indexing', coalesce(v_index, false),
    'settings', jsonb_build_object(
      'tagline', v_settings.store_tagline,
      'shipping_policy', v_settings.shipping_policy,
      'return_policy', v_settings.return_policy
    )
  );
end;
$$;
revoke all on function public.store_public_seller_bundle(text, uuid) from public, anon, authenticated, service_role;


create or replace function public.get_public_storefront(p_seller_type text, p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_handle text := lower(btrim(coalesce(p_handle, '')));
  v_count integer;
  v_user uuid;
  v_bundle jsonb;
  v_products jsonb;
begin
  if p_seller_type is distinct from 'artist' or v_handle = '' then
    return null;
  end if;
  select count(*)::integer, (array_agg(a.user_id))[1]
    into v_count, v_user
    from public.artists_db a
   where lower(a.username) = v_handle
     and a.registration_status is distinct from 'incompleto';
  if v_count <> 1 or v_user is null then
    return null;
  end if;
  v_bundle := public.store_public_seller_bundle('artist', v_user);
  if v_bundle is null then
    return null;
  end if;
  select coalesce(jsonb_agg(public.store_public_product_json(p) order by p.published_at desc nulls last, p.created_at desc), '[]'::jsonb)
    into v_products
    from public.store_products p
   where p.seller_type = 'artist'
     and p.seller_id = v_user
     and p.status = 'active';
  return v_bundle || jsonb_build_object('products', v_products);
end;
$$;
revoke all on function public.get_public_storefront(text, text) from public, anon, authenticated;
grant execute on function public.get_public_storefront(text, text) to anon, authenticated;


notify pgrst, 'reload schema';
commit;
