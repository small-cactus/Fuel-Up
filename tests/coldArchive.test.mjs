import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256,packArchive,verifyArchive,removalSql,assertStorageCapacity } from '../scripts/storage/coldArchive.mjs';
const text=JSON.stringify({query_key:"a'b",quotes:[{price:3.99}],expires_at:'2026-09-01T00:00:00Z'});
const row={key:"a'b",row_text:text,sha256:sha256(text)};
test('capacity guard reserves the national archive budget and rejects unknown accounting',()=>{
 assert.doesNotThrow(()=>assertStorageCapacity(100_000_000,1_000_000,20_000));
 assert.throws(()=>assertStorageCapacity(100_000_000,49_999_999,2),/capacity/);
 assert.throws(()=>assertStorageCapacity(949_999_999,0,2),/capacity/);
 assert.throws(()=>assertStorageCapacity('unknown',0,2),/accounting/);
});
test('compressed archives preserve exact database JSON and validate read-back',()=>{
 const p=packArchive('expired-query-cache','2026-10-01T00:00:00Z',[row]);
 assert.deepEqual(verifyArchive(p.bytes,p.sha256).rows,[row]);
 assert.throws(()=>verifyArchive(Buffer.concat([p.bytes,Buffer.from('x')]),p.sha256),/SHA-256/);
});
test('rejects changed contents, duplicate keys, and incorrect identities',()=>{
 assert.throws(()=>packArchive('expired-query-cache','2026-10-01',[{...row,row_text:'{}'}]),/Invalid source/);
 assert.throws(()=>packArchive('expired-query-cache','2026-10-01',[row,row]),/Invalid source/);
 assert.throws(()=>packArchive('expired-query-cache','2026-10-01',[{...row,key:'wrong'}]),/key mismatch/);
});
test('removal locks rows and checks all hashes and counts in the manifest transaction',()=>{
 const p=packArchive('expired-query-cache','2026-10-01T00:00:00Z',[row]);
 const sql=removalSql({archive:p.archive,objectPath:'private/x.gz',bytes:p.bytes.length,hash:p.sha256});
 assert.match(sql,/for update of t/);assert.match(sql,/digest\(to_jsonb\(t\)::text/);
 assert.match(sql,/matched<>1/);assert.match(sql,/removed<>1/);assert.match(sql,/a''b/);
 assert.ok(sql.indexOf('insert into public.fuel_cold_archives')<sql.indexOf('delete from public.fuel_query_cache'));
});
