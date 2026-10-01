-- Execute after the migration within BEGIN / ROLLBACK. Never commit fixtures.
do $$
declare current_run bigint; r record; result jsonb; fake_run bigint; job bigint; target_station_id text; old_job bigint;
begin
 select max(run_id) into current_run from fuel_national_trends_cache;
 if current_run is null or (select count(*) from fuel_national_trends_cache)<>10 then raise exception 'Expected ten published scopes'; end if;
 for r in select * from fuel_national_trends_cache loop
  result:=national_fuel_trends(r.fuel_type,r.requires_e85);
  if result->'stations' is distinct from national_fuel_station_cache(r.fuel_type,r.requires_e85)
   or result->'history' is distinct from national_fuel_trend_history(r.fuel_type,r.requires_e85)
   or (result->>'scanId')::bigint<>current_run then raise exception 'Cached output differs from completed scan'; end if;
 end loop;
 if publish_completed_national_trends() then raise exception 'Same complete scan was republished'; end if;
 -- A partial scan must leave the old publication intact.
 insert into fuel_national_runs(slot_at,deadline_at,catalog_id,expected_stations,expected_batches)
 select slot_at+interval '100 years',deadline_at+interval '100 years',catalog_id,expected_stations,expected_batches from fuel_national_runs where id=current_run returning id into fake_run;
 if publish_completed_national_trends() then raise exception 'Partial run published'; end if;
 update fuel_national_runs set status='complete',completed_at=now() where id=fake_run;
 if publish_completed_national_trends() then raise exception 'Incomplete archive coverage published'; end if;
 update fuel_national_runs set status='running' where id=fake_run;
 delete from fuel_national_trends_cache where fuel_type='diesel';
 insert into fuel_national_jobs(run_id,catalog_id,ordinal,status)
 select fake_run,catalog_id,ordinal,'succeeded' from fuel_national_jobs where run_id=current_run limit 1 returning id into job;
 select station_id,job_id into target_station_id,old_job from fuel_station_latest limit 1;
 update fuel_station_latest set job_id=job where station_id=target_station_id;
 if publish_completed_national_trends() then raise exception 'Mixed newer projection published'; end if;
 update fuel_station_latest set job_id=old_job where station_id=target_station_id;
 if not publish_completed_national_trends() then raise exception 'Missing cache scopes were not rebuilt'; end if;
 if (select count(*) from fuel_national_trends_cache)<>10 then raise exception 'Incomplete rebuild'; end if;
 if has_table_privilege('anon','fuel_national_trends_cache','select') or
    has_function_privilege('anon','national_fuel_trends(text,boolean)','execute') or
    has_function_privilege('service_role','publish_completed_national_trends()','execute') then raise exception 'Public cache permissions too broad'; end if;
end $$;
