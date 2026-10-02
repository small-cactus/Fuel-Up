// Admin-only; no provider traffic. Immutable upload -> download -> hash/row
// verification -> locked compare-and-delete transaction. Defaults to read-only.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOURCES, packArchive, verifyArchive, removalSql, sqlLiteral, assertStorageCapacity } from './coldArchive.mjs';
const source = process.argv[2], apply = process.argv.includes('--apply');
if (!SOURCES[source]) throw Error('Usage: node scripts/storage/archiveColdData.mjs expired-query-cache|legacy-station-prices [--apply]');
const config = SOURCES[source];
const project = ['--linked','--project-ref','vjindchxfebaltbslqwc'];
const cli = args => execFileSync('npx',['--no-install','supabase@2.118.0',...args],{encoding:'utf8',maxBuffer:64*1024*1024});
const query = sql => JSON.parse(cli(['db','query',...project,sql,'--output','json'])).rows;
const [{ cutoff, eligible }] = query(`select (now()-interval '${config.ageDays} days') as cutoff,count(*) as eligible from public.${config.table} where ${config.time}<now()-interval '${config.ageDays} days'`);
console.log(JSON.stringify({source,cutoff,eligible,apply}));
if (apply) {
  let total = 0;
  while (true) {
    const rows = query(`select t.${config.key}::text as key,to_jsonb(t)::text as row_text,
      encode(extensions.digest(to_jsonb(t)::text,'sha256'),'hex') as sha256 from public.${config.table} t
      where t.${config.time}<${sqlLiteral(cutoff)}::timestamptz order by t.${config.key} limit 500`);
    if (!rows.length) break;
    const packed = packArchive(source,cutoff,rows);
    const [{ stored, cold }] = query("select coalesce(sum((metadata->>'size')::bigint),0) as stored, coalesce(sum((metadata->>'size')::bigint) filter (where bucket_id='fuel-cold'),0) as cold from storage.objects");
    assertStorageCapacity(stored, cold, packed.bytes.length);
    const path = `${source}/${new Date().toISOString().slice(0,10)}/${randomUUID()}.json.gz`;
    const dir = mkdtempSync(join(tmpdir(),'fuel-cold-archive-'));
    try {
      const local=join(dir,'upload.json.gz'),download=join(dir,'readback.json.gz');
      writeFileSync(local,packed.bytes,{flag:'wx',mode:0o600});
      cli(['storage','cp',local,`ss:///fuel-cold/${path}`,...project,'--experimental']);
      cli(['storage','cp',`ss:///fuel-cold/${path}`,download,...project,'--experimental']);
      const archive = verifyArchive(readFileSync(download),packed.sha256);
      if (JSON.stringify(archive)!==JSON.stringify(packed.archive)) throw Error('Archive read-back mismatch');
      query(removalSql({archive,objectPath:path,bytes:packed.bytes.length,hash:packed.sha256}));
      total+=rows.length;
      console.log(JSON.stringify({verified:true,removed:rows.length,total,path,bytes:packed.bytes.length,sha256:packed.sha256}));
    } finally { rmSync(dir,{recursive:true,force:true}); }
  }
}
