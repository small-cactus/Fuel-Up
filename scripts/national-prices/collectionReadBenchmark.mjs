// Local synthetic read benchmark. Receives only a disposable test cluster.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
export function collectionReadBenchmark({ dir, port }) {
 const quote = value => "'" + value.replaceAll("'", "''") + "'";
 const run = sql => {
  const file=join(dir,'read-benchmark.sql');writeFileSync(file,sql);
  return execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',dir,'-p',String(port),'-d','postgres','-f',file],{encoding:'utf8',maxBuffer:4_000_000});
 };
 run(`insert into fuel_station_latest(station_id,latitude,longitude,station,metadata_observed_at)
 select 'read-fill-'||g,30,-90,jsonb_build_object('id','read-fill-'||g,'prices','[]'::jsonb,'name',repeat(md5(g::text),25)),now()
 from generate_series(1,greatest(0,141660-(select count(*) from fuel_station_latest))) g;
 vacuum analyze fuel_station_latest; vacuum analyze fuel_station_collection_state;`);
 const fixture=JSON.parse(run(`select jsonb_build_object('job_id',j.id,'ids',b.station_ids,
 'payload',(select jsonb_agg(jsonb_build_object('id',id,'prices',l.station->'prices') order by ord)
 from unnest(b.station_ids) with ordinality ids(id,ord) join fuel_station_latest l on l.station_id=id))
 from fuel_national_jobs j join fuel_national_batches b using(catalog_id,ordinal)
 where b.station_ids[1]='bench-1' and not exists(select 1 from fuel_national_trend_batches t where t.job_id=j.id)
 order by j.id desc limit 1;`));
 assert(Number.isInteger(fixture.job_id));
 const ids='array['+fixture.ids.map(quote).join(',')+']::text[]';
 const measurements=[];
 function measure(label,sql) {
  // Restart only this disposable database; OS caching remains a limitation.
  execFileSync('pg_ctl',['-D',join(dir,'data'),'-m','fast','stop'],{stdio:'pipe'});
  execFileSync('pg_ctl',['-D',join(dir,'data'),'-l',join(dir,'postgres.log'),'-o',`-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c shared_buffers=96MB`,'start'],{stdio:'pipe'});
  const result=JSON.parse(run(`begin; explain(analyze,buffers,format json) ${sql}; rollback;`))[0];
  measurements.push({label,executionMs:result['Execution Time'],sharedReadBlocks:result.Plan['Shared Read Blocks'],sharedHitBlocks:result.Plan['Shared Hit Blocks'],tempReadBlocks:result.Plan['Temp Read Blocks'],tempWrittenBlocks:result.Plan['Temp Written Blocks']});
 }
 measure('wide_metadata',`select exists(select 1 from unnest(${ids}) id left join fuel_station_latest s on s.station_id=id where s.metadata_observed_at is null)`);
 measure('compact_metadata',`select fuel_station_metadata_needed(${ids})`);
 for(const scenario of ['unchanged','ten_percent_changed']) {
  const payload=structuredClone(fixture.payload);
  if(scenario==='ten_percent_changed')for(const s of payload.slice(0,200))s.prices[0].credit.price=3.50;
  for(const [label,fn] of [['wide','wide_publish_fuel_station_batch'],['compact','publish_fuel_station_batch']]) {
   const sql=`select ${fn}(${fixture.job_id},${quote(JSON.stringify(payload))}::jsonb)`;
   const n=Number(run(`begin; ${sql}; rollback;`).trim());
   assert.equal(n,scenario==='unchanged'?0:200);
   run('vacuum analyze fuel_station_latest; vacuum analyze fuel_station_collection_state; vacuum analyze fuel_national_trend_batches;');
   measure(label+'_'+scenario,sql);
  }
 }
 const sizes=JSON.parse(run(`select jsonb_build_object('stationTableBytes',pg_table_size('fuel_station_latest'),'compactTableBytes',pg_table_size('fuel_station_collection_state'),'compactTotalBytes',pg_total_relation_size('fuel_station_collection_state'));`));
 return {synthetic:true,stations:141660,batch:2000,sharedBuffersMiB:96,measurements,sizes,
 limitation:'Disposable local PostgreSQL, reset shared buffers between plans. OS filesystem cache remains warm. This measures PostgreSQL block reads, not production hardware IO or sustained capacity.'};
}
