begin; set local statement_timeout='8s';
explain(analyze,buffers,format json) select exists(select 1 from unnest((select station_ids from fuel_national_batches where catalog_id=(select catalog_id from fuel_national_config) and ordinal=0)) id
left join fuel_station_collection_state c on c.station_id=id
where case when c.station_id is not null then not c.metadata_complete
else not exists(select 1 from fuel_station_latest s where s.station_id=id and s.metadata_observed_at is not null) end);
commit;
