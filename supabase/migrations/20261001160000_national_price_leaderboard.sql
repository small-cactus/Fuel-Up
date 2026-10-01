-- Read-only nationwide leaderboard over the immutable-publication serving cache.
-- No upstream requests, estimates, or research-history writes.
create function public.fuel_fresh_payment(p_entry jsonb, p_now timestamptz)
returns jsonb language plpgsql stable set search_path=public,pg_temp as $$
declare q jsonb; posted timestamptz; amount numeric;
begin
 foreach q in array array[p_entry->'credit',p_entry->'cash'] loop
  begin
   if jsonb_typeof(q->'price') <> 'number' then continue; end if;
   amount := (q->>'price')::numeric;
   posted := (q->>'postedTime')::timestamptz;
   if amount>0 and posted<=p_now and posted>=p_now-interval '24 hours' then return q; end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range then
   continue;
  end;
 end loop;
 return null;
end $$;

create function public.national_fuel_station_cache(p_fuel_type text, p_requires_e85 boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare product text; as_of timestamptz := now(); result jsonb;
begin
 product := case p_fuel_type when 'regular' then 'regular_gas' when 'midgrade' then 'midgrade_gas'
  when 'premium' then 'premium_gas' when 'diesel' then 'diesel' when 'e85' then 'e85' end;
 if product is null then raise exception 'Invalid fuel type'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('station',station,'observedAt',observed_at) order by price,station_id),'[]'::jsonb)
 into result from (
  select l.station_id,l.station,l.observed_at,(q.payment->>'price')::numeric price
  from fuel_station_latest l
  cross join lateral jsonb_array_elements(l.station->'prices') entry
  cross join lateral (select fuel_fresh_payment(entry,as_of) payment) q
  where l.observed_at is not null and entry->>'fuelProduct'=product and q.payment is not null
   and l.latitude between -90 and 90 and l.longitude between -180 and 180
   -- Preserve the serving policy that duplicate gasoline grades use the lowest grade.
   and not exists(select 1 from jsonb_array_elements(l.station->'prices') lower_grade
    where ((p_fuel_type='midgrade' and lower_grade->>'fuelProduct'='regular_gas') or
     (p_fuel_type='premium' and lower_grade->>'fuelProduct' in ('regular_gas','midgrade_gas')))
    and round((fuel_fresh_payment(lower_grade,as_of)->>'price')::numeric,3)=round((q.payment->>'price')::numeric,3))
   and (not p_requires_e85 or exists(select 1 from jsonb_array_elements(l.station->'prices') e85
    where e85->>'fuelProduct'='e85' and fuel_fresh_payment(e85,as_of) is not null))
  order by price,l.station_id limit 5
 ) ranked;
 return result;
end $$;
revoke all on function public.fuel_fresh_payment(jsonb,timestamptz),public.national_fuel_station_cache(text,boolean) from public,anon,authenticated;
grant execute on function public.national_fuel_station_cache(text,boolean) to service_role;
