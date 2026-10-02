import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const SOURCES = {
  'expired-query-cache': { table: 'fuel_query_cache', key: 'query_key', time: 'expires_at', ageDays: 1 },
  'legacy-station-prices': { table: 'station_prices', key: 'id', time: 'created_at', ageDays: 30 },
};
export function assertStorageCapacity(storedBytes, coldBytes, incomingBytes) {
  const values = [storedBytes, coldBytes, incomingBytes].map(Number);
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) throw Error('Invalid storage accounting');
  // Keep the existing 900 MB nationwide research budget plus 50 MB headroom.
  if (values[0] + values[2] > 950_000_000 || values[1] + values[2] > 50_000_000) {
    throw Error('Storage capacity guard');
  }
}
export function packArchive(source, cutoff, rows) {
  if (!SOURCES[source] || !Number.isFinite(Date.parse(cutoff)) || !rows.length) throw Error('Invalid archive');
  const seen = new Set();
  for (const row of rows) {
    if (typeof row.key !== 'string' || seen.has(row.key) || sha256(row.row_text) !== row.sha256) throw Error('Invalid source row');
    if (String(JSON.parse(row.row_text)[SOURCES[source].key]) !== row.key) throw Error('Source key mismatch');
    seen.add(row.key);
  }
  const archive = { version: 1, source, table: SOURCES[source].table, cutoff, rows };
  const bytes = gzipSync(JSON.stringify(archive));
  return { bytes, sha256: sha256(bytes), archive };
}
export function verifyArchive(bytes, expectedHash) {
  if (sha256(bytes) !== expectedHash) throw Error('Archive SHA-256 mismatch');
  const archive = JSON.parse(gunzipSync(bytes));
  if (archive.version !== 1 || archive.table !== SOURCES[archive.source]?.table) throw Error('Unsupported archive');
  packArchive(archive.source, archive.cutoff, archive.rows);
  return archive;
}
export const sqlLiteral = value => `'${String(value).replaceAll("'", "''")}'`;
export function removalSql({ archive, objectPath, bytes, hash }) {
  const source = SOURCES[archive.source];
  if (!source || archive.table !== source.table || !/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid manifest');
  const keys = archive.rows.map(row => ({ key: row.key, sha256: row.sha256 }));
  // Lock and recompare the exact database JSON representation. A concurrent
  // refresh or edit invalidates the batch, and the entire removal rolls back.
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create temporary table archive_keys(key text primary key,sha256 text) on commit drop;
insert into archive_keys select * from jsonb_to_recordset(${sqlLiteral(JSON.stringify(keys))}::jsonb) as x(key text,sha256 text);
do $archive$ declare matched integer; removed integer; begin
 perform 1 from public.${source.table} t join archive_keys k on t.${source.key}::text=k.key for update of t;
 select count(*) into matched from public.${source.table} t join archive_keys k on t.${source.key}::text=k.key
 where t.${source.time}<${sqlLiteral(archive.cutoff)}::timestamptz
 and encode(extensions.digest(to_jsonb(t)::text,'sha256'),'hex')=k.sha256;
 if matched<>${keys.length} then raise exception 'Archive source changed; no rows removed'; end if;
 insert into public.fuel_cold_archives(object_path,source_table,cutoff,row_count,archive_bytes,sha256,verified_at)
 values(${sqlLiteral(objectPath)},${sqlLiteral(source.table)},${sqlLiteral(archive.cutoff)},${keys.length},${bytes},${sqlLiteral(hash)},now());
 delete from public.${source.table} t using archive_keys k where t.${source.key}::text=k.key;
 get diagnostics removed=row_count;
 if removed<>${keys.length} then raise exception 'Archive removal count mismatch'; end if;
end $archive$;
commit;`;
}
