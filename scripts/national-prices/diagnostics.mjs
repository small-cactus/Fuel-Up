// Read-only fallback: independent host metrics still work when SQL is stalled.
// Never calls a collector, modifies configuration, or prints credentials.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const project = 'vjindchxfebaltbslqwc';
const cli = args => execFileSync('npx', ['--no-install', 'supabase@2.118.0', ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 35000, maxBuffer: 2_000_000,
});
const coreSql = `select jsonb_build_object(
 'observed_at',now(),
 'config',(select to_jsonb(c) from fuel_national_config c),
 'runs',(select jsonb_agg(x) from (select id,slot_at,status,deadline_at,completed_at
   from fuel_national_runs order by slot_at desc limit 24)x),
 'batches',(select jsonb_agg(x) from (select r.slot_at,j.status,count(*) batches,
   sum(j.attempts) attempts from fuel_national_runs r join fuel_national_jobs j on j.run_id=r.id
   where r.slot_at>=date_trunc('hour',now())-interval '24 hours'
   group by r.slot_at,j.status order by r.slot_at desc,j.status)x),
 'slots',(with slots as (
   select s from fuel_national_config c cross join lateral
    generate_series(c.operational_starts_at,date_trunc('hour',now()),interval '1 hour') s
   where c.continuous and s>=now()-interval '8 days'
  ) select jsonb_build_object('expected',count(*),
    'complete',count(*) filter(where r.status='complete'),
    'partial',count(*) filter(where r.status='partial'),
    'expired_absent',count(*) filter(where r.id is null and s+interval '1 hour'<=now()),
    'current_absent',count(*) filter(where r.id is null and s+interval '1 hour'>now()),
    'expired_running',count(*) filter(where r.status='running' and r.deadline_at<=now()))
   from slots left join fuel_national_runs r on r.slot_at=s),
 'cache',(select jsonb_build_object('run_id',min(run_id),'published_at',min(published_at),'scopes',count(*))
   from fuel_national_trends_cache),
 'activity',(select jsonb_agg(x) from (select backend_type,state,wait_event_type,wait_event,count(*)
   from pg_stat_activity group by 1,2,3,4)x),
 'schedules',(select jsonb_agg(jsonb_build_object('name',jobname,'active',active,'schedule',schedule))
   from cron.job where jobname like 'fuel-national-%' or jobname='fuel-local-history-retention')
) as diagnostics;`;

export function failureKind(error) {
  const message = String(error?.stderr || error?.message || error);
  if (/57014|statement timeout/.test(message)) return 'STATEMENT_TIMEOUT';
  if (/544|connection timeout/.test(message)) return 'DATABASE_CONNECTION_TIMEOUT';
  if (/524/.test(message)) return 'MANAGEMENT_GATEWAY_TIMEOUT';
  if (/ETIMEDOUT|TimeoutError|timed out/.test(message)) return 'CLIENT_TIMEOUT';
  return 'READ_FAILED';
}

const metricNames = new Set([
  'node_load1', 'node_load5', 'node_load15',
  'node_memory_MemTotal_bytes', 'node_memory_MemAvailable_bytes',
  'node_memory_SwapTotal_bytes', 'node_memory_SwapFree_bytes',
  'node_vmstat_pswpin', 'node_vmstat_pswpout',
  'node_cpu_seconds_total', 'node_disk_io_time_seconds_total',
  'node_disk_read_bytes_total', 'node_disk_written_bytes_total',
  'node_filesystem_avail_bytes',
]);
export function summarizeMetrics(source) {
  const metrics = [];
  for (const line of source.split('\n')) {
    const match = line.match(/^(\w+)(?:\{([^}]*)\})?\s+([\deE+.-]+)(?:\s+\d+)?$/);
    if (!match || !metricNames.has(match[1]) || !Number.isFinite(Number(match[3]))) continue;
    // Keep only technical dimensions, never arbitrary exporter labels.
    const dimensions = {};
    for (const label of (match[2] || '').matchAll(/(\w+)="([^"]*)"/g)) {
      if (['cpu', 'mode', 'device', 'mountpoint'].includes(label[1])) dimensions[label[1]] = label[2];
    }
    metrics.push({ name: match[1], ...dimensions, value: Number(match[3]) });
  }
  if (!metrics.length) throw Error('No recognized host metrics');
  return metrics;
}

async function hostMetrics() {
  const keys = JSON.parse(cli(['projects', 'api-keys', '--project-ref', project, '--output', 'json']));
  const key = keys.find(item => item.name === 'service_role')?.api_key;
  if (!key) throw Error('Missing metrics authentication');
  const response = await fetch(`https://${project}.supabase.co/customer/v1/privileged/metrics`, {
    headers: { Authorization: `Basic ${Buffer.from(`service_role:${key}`).toString('base64')}` },
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (!response.ok) throw Error(`Metrics HTTP ${response.status}`);
  return summarizeMetrics(await response.text());
}

export async function collectDiagnostics({ query = () => JSON.parse(cli([
  'db', 'query', '--linked', '--project-ref', project, coreSql, '--output', 'json',
])).rows[0].diagnostics, metrics = hostMetrics } = {}) {
  const result = { observedAt: new Date().toISOString(), partial: true, providerRequests: 0 };
  // Host metrics first: unavailable SQL must not hide the independent resource signal.
  for (const [name, read] of [['host', metrics], ['database', query]]) {
    try { result[name] = { ok: true, data: await read() }; }
    catch (error) { result[name] = { ok: false, error: failureKind(error) }; }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await collectDiagnostics();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.host.ok && result.database.ok ? 0 : 1;
}
