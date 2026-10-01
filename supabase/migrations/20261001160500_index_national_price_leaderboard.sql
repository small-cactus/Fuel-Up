-- Keep an indexed read projection as part of each existing serving transaction.
-- Unchanged quotes are not rewritten. Raw station JSON and archives are untouched.
create function public.fuel_reported_at(p_value text) returns timestamptz
language plpgsql immutable strict set search_path=public,pg_temp as $$
begin
 if p_value !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then return null; end if;
 return p_value::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;
create table public.fuel_station_price_lookup (
 station_id text not null references public.fuel_station_latest(station_id) on delete cascade,
 fuel_product text not null, payment text not null check(payment in ('credit','cash')),
 price numeric not null check(price>0),reported_at timestamptz not null,
 primary key(station_id,fuel_product,payment)
);
alter table public.fuel_station_price_lookup enable row level security;
create index fuel_national_price_order on public.fuel_station_price_lookup(fuel_product,price,station_id) include(reported_at,payment);

create function public.project_fuel_station_prices() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 delete from fuel_station_price_lookup p where p.station_id=new.station_id and not exists(
  select 1 from jsonb_array_elements(new.station->'prices') e
  where e->>'fuelProduct'=p.fuel_product and jsonb_typeof(e->p.payment->'price')='number'
   and (e->p.payment->>'price')::numeric>0 and fuel_reported_at(e->p.payment->>'postedTime') is not null);
 insert into fuel_station_price_lookup as target(station_id,fuel_product,payment,price,reported_at)
 select new.station_id,e->>'fuelProduct',payment,(e->payment->>'price')::numeric,fuel_reported_at(e->payment->>'postedTime')
 from jsonb_array_elements(new.station->'prices') e cross join unnest(array['credit','cash']) payment
 where jsonb_typeof(e->payment->'price')='number' and (e->payment->>'price')::numeric>0
  and fuel_reported_at(e->payment->>'postedTime') is not null
 on conflict(station_id,fuel_product,payment) do update set price=excluded.price,reported_at=excluded.reported_at
 where (target.price,target.reported_at) is distinct from (excluded.price,excluded.reported_at);
 return new;
end $$;
create trigger fuel_price_lookup_insert after insert on public.fuel_station_latest for each row execute function public.project_fuel_station_prices();
create trigger fuel_price_lookup_update after update of station on public.fuel_station_latest for each row
 when(old.station->'prices' is distinct from new.station->'prices') execute function public.project_fuel_station_prices();
insert into public.fuel_station_price_lookup(station_id,fuel_product,payment,price,reported_at)
 select station_id,e->>'fuelProduct',payment,(e->payment->>'price')::numeric,fuel_reported_at(e->payment->>'postedTime')
 from public.fuel_station_latest cross join lateral jsonb_array_elements(station->'prices') e cross join unnest(array['credit','cash']) payment
 where jsonb_typeof(e->payment->'price')='number' and (e->payment->>'price')::numeric>0
  and fuel_reported_at(e->payment->>'postedTime') is not null;
analyze public.fuel_station_price_lookup;

create or replace function public.national_fuel_station_cache(p_fuel_type text,p_requires_e85 boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare product text; as_of timestamptz := now(); result jsonb;
begin
 product := case p_fuel_type when 'regular' then 'regular_gas' when 'midgrade' then 'midgrade_gas'
  when 'premium' then 'premium_gas' when 'diesel' then 'diesel' when 'e85' then 'e85' end;
 if product is null then raise exception 'Invalid fuel type'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('station',station,'observedAt',observed_at) order by price,station_id),'[]'::jsonb)
 into result from (
  select l.station_id,l.station,l.observed_at,q.price
  from fuel_station_price_lookup q join fuel_station_latest l using(station_id)
  where q.fuel_product=product and q.reported_at between as_of-interval '24 hours' and as_of
   and l.observed_at is not null and l.latitude between -90 and 90 and l.longitude between -180 and 180
   and (q.payment='credit' or not exists(select 1 from fuel_station_price_lookup credit
    where credit.station_id=q.station_id and credit.fuel_product=product and credit.payment='credit'
    and credit.reported_at between as_of-interval '24 hours' and as_of))
   and not exists(select 1 from jsonb_array_elements(l.station->'prices') lower_grade
    where ((p_fuel_type='midgrade' and lower_grade->>'fuelProduct'='regular_gas') or
     (p_fuel_type='premium' and lower_grade->>'fuelProduct' in ('regular_gas','midgrade_gas')))
    and round((fuel_fresh_payment(lower_grade,as_of)->>'price')::numeric,3)=round(q.price,3))
   and (not p_requires_e85 or exists(select 1 from fuel_station_price_lookup e85 where e85.station_id=q.station_id
    and e85.fuel_product='e85' and e85.reported_at between as_of-interval '24 hours' and as_of))
  order by q.price,q.station_id limit 5
 ) ranked;
 return result;
end $$;
revoke all on table public.fuel_station_price_lookup from anon,authenticated;
revoke all on function public.fuel_reported_at(text),public.project_fuel_station_prices() from public,anon,authenticated;
