-- Exercise the real compact-state fast path with ordinary price-only payloads.
do $$
declare cat uuid; j bigint; newer bigint; old bigint; data jsonb; rows_written integer;
 base_tuple text; state_tuple text; saved jsonb;
begin
 insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count) values(2,51,'{}',1) returning id into cat;
 insert into fuel_national_batches values(cat,0,array['compact-a','compact-b']);
 data:='[{"id":"compact-a","name":"Known","latitude":30,"longitude":-80,"prices":[]},{"id":"compact-b","latitude":30,"longitude":-80,"prices":[]}]';
 j:=test_job(cat,0,now()+interval '500 hours');
 perform test_assert(publish_fuel_station_batch(j,data)=2,'Initial compact state publication');
 perform test_assert(not fuel_station_metadata_needed(array['compact-a']),'Known metadata was missed');
 perform test_assert(fuel_station_metadata_needed(array['compact-b']),'Missing metadata was ignored');
 perform test_assert(fuel_station_metadata_needed(array['missing']),'Absent station was ignored');
 perform test_assert(fuel_station_metadata_needed(array[null::text]),'Null station was ignored');
 perform test_assert(not fuel_station_metadata_needed('{}') and not fuel_station_metadata_needed(null),'Empty metadata input mismatch');
 delete from fuel_station_collection_state where station_id='compact-a';
 perform test_assert(not fuel_station_metadata_needed(array['compact-a']),'Unprepared known station fallback');
 select ctid::text into base_tuple from fuel_station_latest where station_id='compact-a';
 perform test_assert(prepare_fuel_station_collection_state(cat,0)=1,'Preparation must insert missing state only');
 perform test_assert(prepare_fuel_station_collection_state(cat,0)=0,'Preparation must be idempotent');
 perform test_assert((select ctid::text=base_tuple from fuel_station_latest where station_id='compact-a'),'Preparation rewrote station');
 select ctid::text into state_tuple from fuel_station_collection_state where station_id='compact-a';
 data:='[{"id":"compact-a","prices":[]},{"id":"compact-b","prices":[]}]';
 newer:=test_job(cat,0,now()+interval '501 hours');
 perform test_assert(publish_fuel_station_batch(newer,data)=0,'Price-only unchanged data rewrote station');
 perform test_assert((select ctid::text=state_tuple from fuel_station_collection_state where station_id='compact-a'),'Unchanged data rewrote compact state');
 perform test_assert((select job_id=newer from fuel_station_current where station_id='compact-a'),'Compact path did not advance effective observation');
 old:=test_job(cat,0,now()+interval '500 hours 30 minutes');
 data:=jsonb_set(data,'{0,prices}','[{"fuelProduct":"regular_gas","credit":{"price":4,"postedTime":"2026-10-19T00:00:00Z"}}]');
 perform test_assert(publish_fuel_station_batch(old,data)=0,'Late price bypassed compact receipt fence');
 j:=test_job(cat,0,now()+interval '502 hours');
 perform test_assert(publish_fuel_station_batch(j,data)=1,'Changed signature must update exactly one station');
 perform test_assert((select price_signature=sha256(convert_to((station->'prices')::text,'UTF8')) from fuel_station_collection_state c join fuel_station_latest l using(station_id) where station_id='compact-a'),'Changed signature not synchronized');
 data:=jsonb_set(data,'{0,prices,0,credit,price}','4.000');
 j:=test_job(cat,0,now()+interval '503 hours');
 perform test_assert(publish_fuel_station_batch(j,data)=0,'Equivalent numeric JSON rewrote contents');
 data:=jsonb_set(data,'{0,name}','"Renamed"',true);
 j:=test_job(cat,0,now()+interval '504 hours');
 perform test_assert(publish_fuel_station_batch(j,data)=1,'Metadata field was skipped by fast path');
 update fuel_station_latest set e85_listed_at=now() where station_id='compact-a';
 perform test_assert((select e85_listed from fuel_station_collection_state where station_id='compact-a'),'Independent E85 change not synchronized');
 update fuel_station_latest set metadata_observed_at=null where station_id='compact-a';
 perform test_assert(fuel_station_metadata_needed(array['compact-a']),'Independent metadata reset not synchronized');
 update fuel_station_latest set station=jsonb_set(station,'{id}','17') where station_id='compact-a';
 perform test_assert((select not price_only_compatible from fuel_station_collection_state where station_id='compact-a'),'Noncanonical stored ID was trusted');
 data:=jsonb_set(data,'{0}',(data->0)-'name');
 j:=test_job(cat,0,now()+interval '505 hours');
 perform test_assert(publish_fuel_station_batch(j,data)=1,'ID correction was skipped because prices matched');
 perform test_assert((select price_only_compatible from fuel_station_collection_state where station_id='compact-a'),'Corrected ID not synchronized');
 delete from fuel_station_latest where station_id='compact-b';
 perform test_assert(not exists(select 1 from fuel_station_collection_state where station_id='compact-b'),'Deleted station left trusted compact state');
 perform test_assert(not has_table_privilege('service_role','fuel_station_collection_state','update')
  and not has_table_privilege('anon','fuel_station_collection_state','select')
  and not has_function_privilege('anon','fuel_station_metadata_needed(text[])','execute'),'Compact state exposed');
end $$;
-- A downstream failure must also roll back the derived signature/metadata flags.
create trigger test_fail_summary before insert on fuel_national_trend_batches for each row execute function test_fail_summary();
do $$
declare cat uuid; j bigint; before_value jsonb; payload jsonb;
begin
 select observation_catalog_id into cat from fuel_station_latest where station_id='compact-a';
 insert into fuel_station_latest(station_id,latitude,longitude,station) values('compact-b',30,-80,'{"id":"compact-b","prices":[]}');
 select to_jsonb(c) into before_value from fuel_station_collection_state c where station_id='compact-a';
 j:=test_job(cat,0,now()+interval '506 hours');
 payload:='[{"id":"compact-a","name":"Must roll back","prices":[]},{"id":"compact-b","prices":[]}]';
 begin perform publish_fuel_station_batch(j,payload); raise exception 'Expected failure';
 exception when others then if sqlerrm<>'test summary failure' then raise; end if; end;
 perform test_assert((select to_jsonb(c)=before_value from fuel_station_collection_state c where station_id='compact-a'),'Failure committed compact signature or metadata');
end $$;
drop trigger test_fail_summary on fuel_national_trend_batches;
select jsonb_build_object('passed',true,'tests','compact price-only fast path, metadata flags, unprepared fallback, idempotent preparation, unchanged tuples, receipt freshness, stale replay, numeric equivalence, extra metadata, independent E85/reset synchronization, noncanonical ID, deletion, permissions, atomic rollback');

-- Exact archive accounting still includes orphan objects and invalid-size reserve.
do $$declare expected bigint; begin
 insert into storage.objects values('fuel-national','test-orphan','{"size":500}'),('fuel-national','test-unknown','{"size":"unknown"}');
 select greatest((select coalesce(sum(archive_bytes),0) from fuel_national_jobs where archive_deleted_at is null),
  (select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 8000000 end),0) from storage.objects where bucket_id='fuel-national')) into expected;
 perform test_assert(fuel_national_archive_bytes()=expected and expected>=8000500,'Archive accounting lost orphan/invalid-size protection');
 delete from storage.objects where name in ('test-orphan','test-unknown');
end $$;
