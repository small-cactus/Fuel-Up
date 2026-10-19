// Build local-only SQL to compare the old and new publishers using saved archives.
// The caller supplies already audited files; no provider or production writes.
const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
export function archiveReplaySql(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const key = `${sample.job.catalog_id}/${sample.job.ordinal}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  return [...groups.values()].map(group => {
    group.sort((a,b) => Date.parse(a.job.observed_at)-Date.parse(b.job.observed_at));
    if (group.length !== 2) throw Error('Each replay batch requires two archived observations');
    const [first, second] = group;
    if (JSON.stringify(first.stations.map(s=>s.id)) !== JSON.stringify(second.stations.map(s=>s.id))) throw Error('Replay membership mismatch');
    let tag = '$archive_replay$';
    while (JSON.stringify(group).includes(tag)) tag = tag.slice(0,-1) + '_$';
    return `do ${tag}
 declare cat uuid; j1 bigint; j2 bigint; old_payload jsonb:=${literal(first.stations)}; new_payload jsonb:=${literal(second.stations)};
 start_lsn pg_lsn; baseline_wal numeric; candidate_wal numeric; baseline_rows integer; candidate_rows integer;
 baseline_output jsonb; candidate_output jsonb; baseline_totals jsonb; candidate_totals jsonb;
 begin
 insert into fuel_national_catalogs(station_count,region_count,coverage,batch_count) values(jsonb_array_length(old_payload),51,'{}',1) returning id into cat;
 insert into fuel_national_batches select cat,0,array_agg(s->>'id' order by ord) from jsonb_array_elements(old_payload) with ordinality a(s,ord);
 -- Price-only archives have no coordinates. Minimal local metadata permits the
 -- real price payload to replay without obtaining or inventing production metadata.
 insert into fuel_station_latest(station_id,latitude,longitude,station)
 select s->>'id',coalesce((s->>'latitude')::float8,0),coalesce((s->>'longitude')::float8,0),jsonb_build_object('id',s->>'id')
 from jsonb_array_elements(old_payload)s;
 j1:=test_job(cat,0,(${literal(first.job.observed_at)}#>>'{}')::timestamptz);
 j2:=test_job(cat,0,(${literal(second.job.observed_at)}#>>'{}')::timestamptz);
 perform publish_fuel_station_batch(j1,old_payload);
 start_lsn:=pg_current_wal_insert_lsn();
 begin
 baseline_rows:=baseline_publish_fuel_station_batch(j2,new_payload);
 baseline_wal:=pg_wal_lsn_diff(pg_current_wal_insert_lsn(),start_lsn);
 select jsonb_agg(jsonb_build_object('station',l.station,'observedAt',l.observed_at,'jobId',l.job_id,'offersE85',l.e85_listed_at is not null) order by l.station_id)
 into baseline_output from fuel_station_current l where l.station_id in(select s->>'id' from jsonb_array_elements(old_payload)s);
 select totals into baseline_totals from fuel_national_trend_batches where job_id=j2;
 raise exception using errcode='Z0001',message='rollback replay baseline';
 exception when sqlstate 'Z0001' then null; end;
 start_lsn:=pg_current_wal_insert_lsn();
 candidate_rows:=publish_fuel_station_batch(j2,new_payload);
 candidate_wal:=pg_wal_lsn_diff(pg_current_wal_insert_lsn(),start_lsn);
 select jsonb_agg(jsonb_build_object('station',l.station,'observedAt',l.observed_at,'jobId',l.job_id,'offersE85',l.e85_listed_at is not null) order by l.station_id)
 into candidate_output from fuel_station_current l where l.station_id in(select s->>'id' from jsonb_array_elements(old_payload)s);
 select totals into candidate_totals from fuel_national_trend_batches where job_id=j2;
 perform test_assert(candidate_output=baseline_output,'Real archive serving parity failed');
 perform test_assert(candidate_totals=baseline_totals,'Real archive trend totals parity failed');
 insert into measurements values(${literal(second.job.execution_region)}#>>'{}',baseline_rows,candidate_rows,baseline_wal,candidate_wal);
 end ${tag};`;
  }).join('\n') + `\nselect jsonb_build_object('archiveReplayPassed',true,'measurements',(select jsonb_agg(to_jsonb(m)) from measurements m),'limitation','Real saved prices, minimal local station metadata; no provider requests; local WAL comparison is not total production IO.') as result;`;
}
