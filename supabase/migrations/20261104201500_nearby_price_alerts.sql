-- Only an explicitly subscribed installation gets a watch. Store the stations
-- Home already filtered, without storing the phone's coordinates.
create table fuel_app_private.price_watches (
 installation_id uuid primary key references public.app_installations on delete cascade,
 stations text[] not null, product text not null, zone text not null,
 started_at timestamptz not null default now(), refreshed_at timestamptz not null default now()
);
create table fuel_app_private.price_samples (
 station_id text not null, product text not null, payment text not null,
 price numeric not null, reported_at timestamptz not null, sampled_at timestamptz not null default now(),
 primary key(station_id,product,payment,reported_at)
);
create table fuel_app_private.price_alert_deliveries (
 id uuid primary key default gen_random_uuid(), installation_id uuid not null references public.app_installations on delete cascade,
 station_id text not null, product text not null, payment text not null, price numeric not null, reported_at timestamptz not null,
 attempted_at timestamptz not null default now(), status text not null default 'sending', reason text,
 unique(installation_id,station_id,product,payment,reported_at)
);
create index on fuel_app_private.price_alert_deliveries(installation_id,attempted_at desc);
revoke all on fuel_app_private.price_watches,fuel_app_private.price_samples,fuel_app_private.price_alert_deliveries from public,anon,authenticated,service_role;

create function public.set_installation_price_watch(p_id uuid,p_hash text,p_stations text[],p_product text,p_zone text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ids text[];
begin
 perform 1 from public.app_installations where id=p_id and token_hash=p_hash for update;
 if not found then raise exception 'unauthorized'; end if;
 if cardinality(p_stations)=0 then
   delete from fuel_app_private.price_watches where installation_id=p_id;
   return '{"watching":0}';
 end if;
 if cardinality(p_stations) not between 1 and 40 or p_product not in ('regular_gas','midgrade_gas','premium_gas','diesel','e85')
   or not exists(select from pg_timezone_names where name=p_zone) then raise exception 'invalid_watch'; end if;
 select array_agg(station_id order by station_id) into ids from public.fuel_station_latest where station_id=any(p_stations);
 if ids is null then raise exception 'invalid_stations'; end if;
 insert into fuel_app_private.price_watches as w(installation_id,stations,product,zone) values(p_id,ids,p_product,p_zone)
 on conflict(installation_id) do update set stations=excluded.stations, product=excluded.product, zone=excluded.zone,
 started_at=case when w.product<>excluded.product or not(w.stations && excluded.stations) or w.refreshed_at<now()-interval '7 days' then now() else w.started_at end, refreshed_at=now();
 return jsonb_build_object('watching',cardinality(ids));
end $$;
revoke all on function public.set_installation_price_watch(uuid,text,text[],text,text) from public,anon,authenticated;
grant execute on function public.set_installation_price_watch(uuid,text,text[],text,text) to service_role;

-- Never issue a provider request. Sample only quotes already published from
-- complete sweeps, preserving the original payment type and report timestamp.
create view fuel_app_private.watched_current_prices as
 with wanted as (select distinct unnest(stations) as station_id, product from fuel_app_private.price_watches
   where refreshed_at >= now()-interval '7 days')
 select w.station_id,w.product,q.payment,q.price,q.reported_at,l.station->>'name' as name
 from wanted w join public.fuel_station_price_lookup q on q.station_id=w.station_id and q.fuel_product=w.product
 join public.fuel_station_current l on l.station_id=w.station_id
 join public.fuel_national_jobs j on j.id=l.job_id join public.fuel_national_runs r on r.id=j.run_id
 where r.status='complete' and j.status='succeeded' and l.observed_at>=now()-interval '3 hours'
 and q.reported_at between now()-interval '12 hours' and now() and q.price>0;
revoke all on fuel_app_private.watched_current_prices from public,anon,authenticated,service_role;

create function fuel_app_private.sample_prices() returns void language plpgsql set search_path='' as $$
begin
 delete from fuel_app_private.price_watches where refreshed_at<now()-interval '7 days';
 delete from fuel_app_private.price_samples where reported_at<now()-interval '36 hours';
 delete from fuel_app_private.price_alert_deliveries where attempted_at<now()-interval '30 days';
 insert into fuel_app_private.price_samples(station_id,product,payment,price,reported_at)
 select station_id,product,payment,price,reported_at from fuel_app_private.watched_current_prices
 on conflict do nothing;
end $$;

create function fuel_app_private.claim_price_alert() returns jsonb language plpgsql set search_path='' as $$
declare c record; delivery_id uuid;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('fuelup-price-alert-claim',0)) then return null; end if;
 with eligible as materialized (
  select w.* from fuel_app_private.price_watches w
  where w.refreshed_at>now()-interval '7 days' and extract(hour from now() at time zone w.zone) between 8 and 20
  and not exists(select from fuel_app_private.price_alert_deliveries d where d.installation_id=w.installation_id
    and d.attempted_at>now()-interval '48 hours')
 ), current_prices as (
  select e.installation_id,e.started_at,p.*,
   min(p.price) over(partition by e.installation_id,p.payment) cheapest
  from eligible e join fuel_app_private.watched_current_prices p on p.station_id=any(e.stations) and p.product=e.product
 )
 select p.*,old.price as previous, d.environment,d.device_token into c from current_prices p
 join public.app_installation_push_devices d using(installation_id)
 cross join lateral (
  select s.price from fuel_app_private.price_samples s where s.station_id=p.station_id and s.product=p.product and s.payment=p.payment
   and s.sampled_at>=p.started_at and s.reported_at<p.reported_at and s.reported_at>=p.reported_at-interval '24 hours'
  order by s.price desc,s.reported_at desc limit 1
 ) old
 where p.price<=p.cheapest+0.05 and old.price-p.price>=greatest(0.10,old.price*0.03)
 and p.reported_at>=p.started_at
 and not exists(select from fuel_app_private.price_alert_deliveries d2 where d2.installation_id=p.installation_id and d2.station_id=p.station_id
  and d2.product=p.product and d2.payment=p.payment and d2.reported_at=p.reported_at)
 order by p.price,old.price-p.price desc,p.reported_at desc,p.station_id limit 1;
 if not found then return null; end if;
 -- Serialize with opt-out, replacement and token rotation before taking the claim.
 perform 1 from fuel_app_private.price_watches where installation_id=c.installation_id and c.station_id=any(stations) and product=c.product for update;
 if not found then return null; end if;
 insert into fuel_app_private.price_alert_deliveries(installation_id,station_id,product,payment,price,reported_at)
 values(c.installation_id,c.station_id,c.product,c.payment,c.price,c.reported_at) returning id into delivery_id;
 return jsonb_build_object('id',delivery_id,'station',c.name,'stationId',c.station_id,'product',c.product,'payment',c.payment,
  'price',c.price,'previous',c.previous,'environment',c.environment,'deviceToken',c.device_token,
  'expiresAt',extract(epoch from least(now()+interval '1 hour',c.reported_at+interval '12 hours')));
end $$;
revoke all on function fuel_app_private.claim_price_alert(),fuel_app_private.sample_prices() from public,anon,authenticated,service_role;
select cron.schedule('fuel-price-alert-samples','7,27,47 * * * *','select fuel_app_private.sample_prices()');
