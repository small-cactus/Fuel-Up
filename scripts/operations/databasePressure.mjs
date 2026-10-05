import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Resource metrics only: no SQL text, credentials, user or station data in output.
export function parseMetrics(text) {
  const values = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^(node_[a-zA-Z0-9_]+)(\{.*\})?\s+([0-9.eE+-]+)$/);
    if (!match) continue;
    const labels = Object.fromEntries([...(match[2] || '').matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    values.set([match[1], labels.device || '', labels.cpu || '', labels.mode || ''].join('|'), Number(match[3]));
  }
  return values;
}
export function summarizePressure(first, last, elapsedSeconds) {
  const get = (m, name) => m.get(`${name}|||`);
  const delta = name => {
    const a = get(first, name), b = get(last, name);
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
  };
  const rebooted = get(first, 'node_boot_time_seconds') !== get(last, 'node_boot_time_seconds');
  const counterDelta = name => rebooted || totalCpu <= 0 ? null : delta(name);
  const disks = {};
  for (const [key, b] of last) {
    const [name, device] = key.split('|');
    if (!device || !['node_disk_read_bytes_total', 'node_disk_written_bytes_total', 'node_disk_io_time_seconds_total'].includes(name)) continue;
    const a = first.get(key);
    (disks[device] ||= {})[name.replace('node_disk_', '').replace('_total', '')] = !rebooted && Number.isFinite(a) && b >= a ? b - a : null;
  }
  let totalCpu = 0, ioWaitCpu = 0;
  for (const [key, b] of last) {
    if (!key.startsWith('node_cpu_seconds_total|')) continue;
    // Linux guest times are already included in user/nice time.
    const mode = key.split('|')[3];
    if (mode.startsWith('guest')) continue;
    const a = first.get(key);
    if (Number.isFinite(a) && b >= a) { totalCpu += b - a; if (mode === 'iowait') ioWaitCpu += b - a; }
  }
  const swapInPages = counterDelta('node_vmstat_pswpin');
  const swapOutPages = counterDelta('node_vmstat_pswpout');
  return {
    elapsedSeconds, rebooted, countersAdvanced: totalCpu > 0,
    limitation: totalCpu > 0 ? null : 'Metrics did not advance; cached samples cannot establish an idle or healthy interval.',
    memoryBytes: { total: get(last, 'node_memory_MemTotal_bytes') ?? null, available: get(last, 'node_memory_MemAvailable_bytes') ?? null,
      swapTotal: get(last, 'node_memory_SwapTotal_bytes') ?? null, swapFree: get(last, 'node_memory_SwapFree_bytes') ?? null },
    swapInPages, swapOutPages,
    // This Supabase x86 host uses 4 KiB pages. Keep page counts too so this
    // conversion is explicit rather than inferred on another architecture.
    swapInBytesAt4KiB: swapInPages === null ? null : swapInPages * 4096,
    swapOutBytesAt4KiB: swapOutPages === null ? null : swapOutPages * 4096,
    majorFaults: counterDelta('node_vmstat_pgmajfault'), oomKills: counterDelta('node_vmstat_oom_kill'),
    cpuIoWaitPercent: !rebooted && totalCpu > 0 ? 100 * ioWaitCpu / totalCpu : null,
    disks: totalCpu > 0 ? disks : Object.fromEntries(Object.entries(disks).map(([k,v]) => [k, Object.fromEntries(Object.keys(v).map(name => [name, null]))])),
  };
}

async function main() {
  const seconds = Number(process.argv[2] || 60);
  if (!Number.isFinite(seconds) || seconds < 5 || seconds > 60) throw Error('Sample interval must be 5–60 seconds');
  const project = 'vjindchxfebaltbslqwc';
  const keys = JSON.parse(execFileSync('npx', ['--no-install', 'supabase@2.118.0', 'projects', 'api-keys', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const key = keys.find(k => k.name === 'service_role')?.api_key;
  if (!key) throw Error('Authenticated service role key unavailable');
  async function sample() {
    const response = await fetch(`https://${project}.supabase.co/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${key}`).toString('base64')}` }, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error(`Metrics HTTP ${response.status}`);
    const metrics = parseMetrics(await response.text());
    if (!metrics.has('node_memory_MemTotal_bytes|||')) throw Error('Resource metrics missing');
    return { metrics, time: Date.now() };
  }
  const first = await sample();
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  const last = await sample();
  console.log(JSON.stringify({ sampledAt: new Date(last.time).toISOString(), project, ...summarizePressure(first.metrics, last.metrics, (last.time - first.time) / 1000) }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
