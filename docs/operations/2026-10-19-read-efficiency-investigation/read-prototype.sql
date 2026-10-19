\set ON_ERROR_STOP on
create schema read_prototype;
set search_path=read_prototype,public;
create table stations(station_id text primary key, metadata_observed_at timestamptz, station jsonb);
insert into stations select g::text,now(),jsonb_build_object('id',g::text,'padding',repeat(md5(g::text),25)) from generate_series(1,141660) g;
vacuum analyze stations;
create function baseline(ids text[]) returns boolean language sql stable as $$select exists(select 1 from unnest(ids) id left join stations s on s.station_id=id where s.metadata_observed_at is null)$$;
explain(analyze,buffers,format json) select exists(select 1 from unnest(array(select g::text from generate_series(1,2000)g)) id left join stations s on s.station_id=id where s.metadata_observed_at is null);
create index metadata_covering on stations(station_id) include(metadata_observed_at);
vacuum analyze stations;
explain(analyze,buffers,format json) select exists(select 1 from unnest(array(select g::text from generate_series(1,2000)g)) id left join stations s on s.station_id=id where s.metadata_observed_at is null);
create table metadata_complete(station_id text primary key);
insert into metadata_complete select station_id from stations where metadata_observed_at is not null;
vacuum analyze metadata_complete;
explain(analyze,buffers,format json) select exists(select 1 from unnest(array(select g::text from generate_series(1,2000)g)) id where not exists(select 1 from metadata_complete s where s.station_id=id));
select jsonb_build_object('synthetic',true,'station_rows',141660,'full_table_bytes',pg_table_size('stations'),'covering_index_bytes',pg_relation_size('metadata_covering'),'compact_table_and_index_bytes',pg_total_relation_size('metadata_complete'));
-- Exact boolean equivalence, including missing metadata and absent stations.
update stations set metadata_observed_at=null where station_id='10';
delete from metadata_complete where station_id='10';
do $$declare ids text[]; a boolean; b boolean; begin
 foreach ids slice 1 in array array[array['1','2'],array['10','1'],array['missing','1'],array[null::text,'1']] loop
  select baseline(ids) into a;
  select exists(select 1 from unnest(ids) id where not exists(select 1 from metadata_complete s where s.station_id=id)) into b;
  if a is distinct from b then raise exception 'Metadata result mismatch';end if;
 end loop;
 if baseline('{}') is distinct from false then raise exception 'Empty batch mismatch';end if;
end $$;
select jsonb_build_object('metadata_semantics','passed');
drop schema read_prototype cascade;
