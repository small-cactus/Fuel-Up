// Protected read-only snapshot for offline audits. Never commit the raw output.
// Usage: node scripts/driving-research/exportSnapshot.mjs /private/tmp/NEW_DIR CUTOFF_ISO
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync, realpathSync} from 'node:fs';
import {resolve, dirname, basename, sep} from 'node:path';

const [output, cutoff] = process.argv.slice(2);
if (!output || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(cutoff || '')
    || !Number.isFinite(Date.parse(cutoff))) throw Error('Provide a new private directory and UTC cutoff');
const destination = resolve(realpathSync(dirname(resolve(output))), basename(output));
const repository = realpathSync(process.cwd());
if (destination === repository || destination.startsWith(repository + sep)) {
  throw Error('Keep sensitive exports outside the repository');
}
mkdirSync(destination, {mode: 0o700}); // Existing directories fail: no accidental mixing of snapshots.
function query(sql) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let raw;
      try {
        raw = execFileSync('npx', ['--no-install', 'supabase@2.118.0', 'db', 'query',
          '--linked', '--project-ref', 'vjindchxfebaltbslqwc', sql, '--output', 'json'],
        {encoding: 'utf8', timeout: 60000, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
      } catch (error) {
        if (error.code !== 'ETIMEDOUT' || !error.stdout) throw error;
        raw = error.stdout; // CLI telemetry shutdown may time out after returning the result.
      }
      const result = JSON.parse(raw);
      if (!Array.isArray(result.rows)) throw Error('Missing rows');
      return result.rows;
    } catch {
      if (attempt === 2) throw Error('Read-only snapshot query failed after three attempts');
    }
  }
}
function save(name, rows) {
  writeFileSync(resolve(destination, name), JSON.stringify({ok: true, data: {rows}}), {mode: 0o600, flag: 'wx'});
}
const window = `received_at < '${cutoff}'::timestamptz`;
const kinds = query(`select event->>'kind' kind, count(*)::int n from driving_research_events where ${window} group by 1`);
save('kinds.json', kinds);
const visits = query(`select participant_id,id,received_at,event from driving_research_events where ${window} and event->>'kind' like 'visit_%' order by received_at,id`);
save('visits.json', visits);
const days = query(`select distinct to_char(received_at at time zone 'UTC','YYYY-MM-DD') as export_day from driving_research_events where ${window} order by 1`);
const counts = new Map();
function count(rows) { for (const r of rows) counts.set(r.event.kind, (counts.get(r.event.kind) || 0) + 1); }
count(visits);
for (const {export_day: day} of days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error('Invalid day');
  const dayWindow = `${window} and received_at >= '${day}'::timestamptz and received_at < '${day}'::timestamptz + interval '1 day'`;
  for (const [prefix, predicate] of [
    ['locations', "event->>'kind' = 'location'"],
    ['aux', "event->>'kind' not like 'visit_%' and event->>'kind' not in ('location','geofence','station_catalog')"],
  ]) {
    const rows = query(`select participant_id,id,received_at,event from driving_research_events where ${dayWindow} and (${predicate}) order by received_at,id`);
    save(`${prefix}-${day}.json`, rows);
    count(rows);
    console.log(`${day} ${prefix}: ${rows.length} events`);
  }
}
for (const {kind, n} of kinds) {
  if (!['geofence','station_catalog'].includes(kind) && (counts.get(kind) || 0) !== n) throw Error(`Incomplete export: ${kind}`);
}
save('manifest.json', [{cutoff, complete: true, excluded_kinds: ['geofence','station_catalog'], counts: Object.fromEntries(counts)}]);
console.log('Frozen export complete; counts match the database cutoff. Raw data stays private.');
