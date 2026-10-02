// Read-only export of verified private archives. Requires the operator's
// existing Supabase CLI login; never embeds a service key in the application.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, openSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOURCES, sqlLiteral, verifyArchive } from './coldArchive.mjs';

const [source, destination] = process.argv.slice(2);
if (!SOURCES[source] || !destination) {
  throw Error('Usage: node scripts/storage/exportColdData.mjs expired-query-cache|legacy-station-prices NEW_OUTPUT.ndjson');
}
const project = ['--linked', '--project-ref', 'vjindchxfebaltbslqwc'];
const cli = args => execFileSync('npx', ['--no-install', 'supabase@2.118.0', ...args], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const manifests = JSON.parse(cli(['db', 'query', ...project,
  `select * from public.fuel_cold_archives where source_table=${sqlLiteral(SOURCES[source].table)} order by verified_at,object_path`,
  '--output', 'json'])).rows;
const dir = mkdtempSync(join(tmpdir(), 'fuel-cold-export-'));
let output, count = 0;
try {
  output = openSync(destination, 'wx', 0o600);
  for (const manifest of manifests) {
    const download = join(dir, 'readback.json.gz');
    rmSync(download, { force: true });
    cli(['storage', 'cp', `ss:///fuel-cold/${manifest.object_path}`, download, ...project, '--experimental']);
    const bytes = readFileSync(download);
    const archive = verifyArchive(bytes, manifest.sha256);
    if (bytes.length !== Number(manifest.archive_bytes) || archive.source !== source ||
        archive.rows.length !== Number(manifest.row_count)) throw Error('Archive manifest mismatch');
    for (const row of archive.rows) writeSync(output, `${row.row_text}\n`);
    count += archive.rows.length;
  }
  console.log(JSON.stringify({ verified: true, archives: manifests.length, rows: count, destination }));
} catch (error) {
  // Never leave a partial export that could be mistaken for complete history.
  if (output !== undefined) { closeSync(output); output = undefined; rmSync(destination); }
  throw error;
} finally {
  if (output !== undefined) closeSync(output);
  rmSync(dir, { recursive: true, force: true });
}
