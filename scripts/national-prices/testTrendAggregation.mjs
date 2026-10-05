import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Test the candidate transactionally against the previous implementation.
// No provider requests; every fixture/function change rolls back.
const previous = readFileSync(new URL('../../supabase/migrations/20261001193000_e85_station_availability.sql', import.meta.url), 'utf8');
const start = previous.indexOf('create or replace function public.record_fuel_national_trend_batch');
const end = previous.indexOf('end $$;', start) + 'end $$;'.length;
if (start < 0 || end < start) throw Error('Missing baseline function');
const baseline = previous.slice(start, end).replace('public.record_fuel_national_trend_batch', 'pg_temp.record_fuel_national_trend_batch_baseline');
const candidate = readFileSync(new URL('../../supabase/migrations/20261005152000_narrow_national_trend_aggregation.sql', import.meta.url), 'utf8');
const assertions = readFileSync(new URL('../../tests/sql/narrowNationalTrendAggregation.sql', import.meta.url), 'utf8');
const sql = `begin; set local statement_timeout='40s'; set local lock_timeout='3s';\n${baseline}\n${candidate}\n${assertions}\nrollback; select 'passed: regional parity, policy, replay, coverage, archive guard; all changes rolled back' as result;`;
const output = execFileSync('npx', ['--no-install', 'supabase@2.118.0', 'db', 'query', '--linked', '--project-ref', 'vjindchxfebaltbslqwc', sql, '--output', 'json'], { encoding: 'utf8', maxBuffer: 1_000_000 });
console.log(JSON.stringify(JSON.parse(output).rows, null, 2));
