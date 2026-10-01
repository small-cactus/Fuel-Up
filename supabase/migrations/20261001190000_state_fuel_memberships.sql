-- Small, public access-program directory from the existing cached inventory.
-- No provider fetch, raw-price reads, personal data, or membership submissions.
create index if not exists fuel_station_latest_state on public.fuel_station_latest ((station #>> '{address,region}'));
create or replace function public.fuel_memberships_for_state(p_state text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 with names as (
  select lower(replace(replace(trim(station->>'name'),'''',''),'’','')) name
  from fuel_station_latest where station #>> '{address,region}' = upper(trim(p_state))
   and upper(trim(p_state)) = any(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY',' '))
 ), programs as (
  select distinct case
   when name ~ '^costco(\s|$)' then 'costco'
   when name ~ '^sams\s+club(\s|$)' then 'sams'
   when name ~ '^bjs(\s+(wholesale(\s+club)?|gas|fuel))?$' then 'bjs'
   end id from names
 ), available as (
  select id from programs where id is not null
  union select 'walmart-plus' where exists(select 1 from programs where id='sams')
 ) select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from available;
$$;
revoke all on function public.fuel_memberships_for_state(text) from public;
grant execute on function public.fuel_memberships_for_state(text) to anon, authenticated, service_role;
