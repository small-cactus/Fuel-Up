// Isolated PostgreSQL integration test. Never connects to Supabase or a provider.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { archiveReplaySql } from './stationDedupReplay.mjs';
import { collectionReadBenchmark } from './collectionReadBenchmark.mjs';
const root = new URL('../../', import.meta.url);
// Test the deployed read path by default; 0 retains the earlier write-only comparison.
const compactCollection = process.env.FUELUP_TEST_COMPACT_COLLECTION !== '0';
const read = path => readFileSync(new URL(path, root), 'utf8');
const migration = name => read(`supabase/migrations/${name}.sql`);
const functionSql = (name, file) => {
  const source = migration(file), start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`, 'i'));
  if (start < 0) throw Error(`Missing function ${name}`);
  const tail = source.slice(start), delimiter = tail.match(/as (\$\w*\$)/i)?.[1];
  const end = tail.indexOf(delimiter, tail.indexOf(delimiter) + delimiter.length);
  return tail.slice(0, end + delimiter.length + 1);
};
const queue = migration('20260930200000_fuel_national_queue').split('do $$ declare t text;')[0];
const tables = migration('20261001143000_fuel_station_serving').split('-- Coordinates come')[0];
const trends = migration('20261001170000_national_trend_history').split('create function public.record_')[0];
const cache = migration('20261001180000_completed_national_trends_cache').split('create function public.publish_')[0];
const lookup = migration('20261001160500_index_national_price_leaderboard').split('create or replace function public.national_')[0];
const e85 = migration('20261001193000_e85_station_availability').split('update public.fuel_station_latest l')[0];
const initial = `create role anon; create role authenticated; create role service_role;
${queue}\n${tables}
alter table fuel_station_latest add column metadata_observed_at timestamptz;
alter table fuel_national_config add column continuous boolean default false, add column operational_starts_at timestamptz, add column operational_raw_hours integer default 48;
alter table fuel_national_jobs add column archive_deleted_at timestamptz;
alter table fuel_national_events add column retained_job_id bigint,add column retained_run_id bigint;
create schema storage; create table storage.objects(bucket_id text,name text,metadata jsonb);
create table fuel_projection_repairs(job_id bigint primary key references fuel_national_jobs(id),lease_until timestamptz);
create table fuel_e85_directory(source text,source_id text,canonical_source_id text,matched_station_id text,active boolean,latitude double precision,longitude double precision,fetched_at timestamptz,name text,street text,city text,state text,postal_code text);
${trends}\n${cache}
alter table fuel_national_trends_cache add column e85_availability_version integer not null default 0;
${functionSql('fuel_fresh_payment','20261001160000_national_price_leaderboard')}
${lookup}\n${e85}
${migration('20261005152000_narrow_national_trend_aggregation')}
${functionSql('national_fuel_trend_history','20261001170000_national_trend_history')}
${functionSql('publish_fuel_station_batch','20261001170000_national_trend_history').replace('public.publish_fuel_station_batch','public.baseline_publish_fuel_station_batch')}
${migration('20261019190000_deduplicate_station_publication')}
${compactCollection ? functionSql('nearby_fuel_station_cache','20261019190000_deduplicate_station_publication').replace('public.nearby_fuel_station_cache','public.wide_nearby_fuel_station_cache') + '\n' + functionSql('record_fuel_national_trend_batch','20261005152000_narrow_national_trend_aggregation').replace('public.record_fuel_national_trend_batch','public.wide_record_fuel_national_trend_batch') + '\n' + functionSql('publish_fuel_station_batch','20261019190000_deduplicate_station_publication').replace('public.publish_fuel_station_batch','public.wide_publish_fuel_station_batch').replace('perform record_fuel_national_trend_batch','perform wide_record_fuel_national_trend_batch') + '\n' + migration('20261019193000_compact_station_collection_state') : ''}
${read('tests/sql/stationPublicationDedup.sql')}
${compactCollection ? read('tests/sql/stationCollectionState.sql') + '\n' + read('tests/sql/stationGeographicBounds.sql') : ''}
${process.argv[2] ? archiveReplaySql(JSON.parse(readFileSync(process.argv[2], 'utf8'))) : ''}
${read('tests/sql/verificationAllowance.sql').replace('-- INSERT_ALLOWANCE_MIGRATION',migration('20261019190100_bounded_verification_sweeps'))}`;
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const dir = mkdtempSync(join(tmpdir(), 'fuel-dedup-test-'));
let started = false;
try {
  execFileSync('initdb', ['-D',join(dir,'data'),'-A','trust','--no-locale'], { stdio:'pipe' });
  execFileSync('pg_ctl', ['-D',join(dir,'data'),'-l',join(dir,'postgres.log'),'-o',`-p ${port} -k ${dir} -c listen_addresses=127.0.0.1`,'start'], { stdio:'pipe' });
  started = true;
  writeFileSync(join(dir,'test.sql'), initial);
  console.log(execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',dir,'-p',String(port),'-d','postgres','-f',join(dir,'test.sql')],{encoding:'utf8',maxBuffer:4_000_000}));
  if (process.env.FUELUP_TEST_READ_BENCHMARK === '1') {
    if (!compactCollection) throw Error('Read benchmark requires compact collection tests');
    console.log(JSON.stringify(collectionReadBenchmark({dir,port})));
  }
} finally {
  if (started) execFileSync('pg_ctl',['-D',join(dir,'data'),'-m','fast','stop'],{stdio:'pipe'});
  rmSync(dir,{recursive:true,force:true});
}
