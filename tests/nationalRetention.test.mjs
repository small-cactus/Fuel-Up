import test from 'node:test';
import assert from 'node:assert/strict';
import { retainNationalService, createNationalRetentionHandler } from '../supabase/functions/_shared/nationalRetention.mjs';
const now = () => Date.parse('2026-10-12T12:00:00Z');
const row = { object_path: '10001/10002/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json.gz',
  slot_at: '2026-10-08T00:00:00Z', deadline_at: '2026-10-08T01:00:00Z', operational_starts_at: '2026-10-07T19:00:00Z' };
function fixture(rows = [row], failure) {
  const calls = [];
  return { calls, db: {
    rpc: async name => { calls.push(name); return name === 'fuel_national_retention_candidates'
      ? { data: rows } : { data: { marked_archives: rows.length }, error: failure === 'reconcile' }; },
    storage: { from: bucket => { assert.equal(bucket, 'fuel-national'); return { remove: async paths => {
      calls.push(['remove', paths]); return { error: failure === 'storage' };
    } }; } },
  } };
}
test('expires only eligible operational objects then reconciles manifests', async () => {
  const f = fixture(); const result = await retainNationalService({ db: f.db, now });
  assert.equal(result.removedObjects, 1); assert.equal(result.providerRequests, 0);
  assert.deepEqual(f.calls, ['fuel_national_retention_candidates', ['remove', [row.object_path]], 'reconcile_fuel_national_retention']);
});
test('preserves research, recent snapshots, future boundaries, and invalid paths', async () => {
  for (const change of [{ slot_at: '2026-10-07T18:00:00Z' }, { deadline_at: '2026-10-12T01:00:00Z' },
    { operational_starts_at: '2026-10-09T00:00:00Z' }, { object_path: '../research' }, { slot_at: 'invalid' }]) {
    const f = fixture([{ ...row, ...change }]);
    await assert.rejects(retainNationalService({ db: f.db, now }), /UNSAFE/);
    assert.deepEqual(f.calls, ['fuel_national_retention_candidates']);
  }
});
test('Storage failure never marks archives as removed', async () => {
  const f = fixture([row], 'storage'); await assert.rejects(retainNationalService({ db: f.db, now }), /STORAGE/);
  assert.equal(f.calls.includes('reconcile_fuel_national_retention'), false);
});
test('empty retry still reconciles deletion committed before a prior crash', async () => {
  const f = fixture([]); const result = await retainNationalService({ db: f.db, now });
  assert.equal(result.removedObjects, 0); assert.deepEqual(f.calls, ['fuel_national_retention_candidates', 'reconcile_fuel_national_retention']);
});
test('reconciliation failure is surfaced for scheduled retry', async () => {
  const f = fixture([row], 'reconcile'); await assert.rejects(retainNationalService({ db: f.db, now }), /RECONCILE/);
});
test('public callers cannot delete or run maintenance', async () => {
  let called = false; const handler = createNationalRetentionHandler({ secret: 'private-test', retain: async () => { called = true; } });
  assert.equal((await handler(new Request('https://example.test', { method: 'POST' }))).status, 401);
  assert.equal(called, false);
});
