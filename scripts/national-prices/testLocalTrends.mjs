import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const migration=readFileSync('supabase/migrations/20261029160000_local_station_trend_history.sql','utf8');
const checks=readFileSync('tests/sql/localTrendHistory.sql','utf8');
const sql=`begin; set local statement_timeout='45s'; set local lock_timeout='3s';\n${migration}\n${checks}\nrollback; select 'local history: prices, freshness, grades, complete sweep, radius, replay, manifest, retention, access passed; rolled back' result;`;
console.log(execFileSync('npx',['--no-install','supabase@2.118.0','db','query','--linked','--project-ref','vjindchxfebaltbslqwc',sql,'--output','json'],{encoding:'utf8',maxBuffer:1000000}));
