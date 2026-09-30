import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIONAL_REGIONS, executionRegionForState } from '../supabase/functions/_shared/nationalRegions.mjs';
import { createNationalRegionHandler } from '../supabase/functions/_shared/nationalRegionHandler.mjs';
import { collectNationalPrices } from '../supabase/functions/_shared/nationalPriceWorker.mjs';
import { planRegionalRefresh } from '../scripts/national-prices/regionalPlan.mjs';
import { US_REGIONS } from '../scripts/national-prices/plan.mjs';

const catalog = () => ({ regions: US_REGIONS.map((code, i) => ({ code, complete: true,
  coverageBasis: 'test fixture', observedAt: new Date().toISOString(), expectedCount: 1, ids: [String(i + 1)] })) });
const request = (body = {}, secret = 'test-only') => new Request('https://example.test', {
  method: 'POST', headers: { 'x-fuel-research-key': secret }, body: JSON.stringify(body) });

test('all 50 states plus DC have exactly one fixed regional owner', () => {
  const states = Object.values(NATIONAL_REGIONS).flatMap(r => r.states);
  assert.equal(states.length, 51); assert.equal(new Set(states).size, 51);
  assert.deepEqual([...states].sort(), [...US_REGIONS].sort());
  assert.equal(executionRegionForState('FL'), 'us-east-1');
  assert.equal(executionRegionForState('CA'), 'us-west-1');
  assert.equal(executionRegionForState('WA'), 'us-west-2');
  assert.throws(() => executionRegionForState('XX'));
});
test('regional batches never mix owners and counts reconcile across the US', () => {
  const p = planRegionalRefresh(catalog(), { batchSize: 10, approvedStationLookupsPerHour: 51 });
  assert.equal(p.stationCount, 51); assert.equal(p.httpRequestsPerHour, 6);
  assert.deepEqual(p.regions.map(r => r.stations), [38, 7, 6]);
  assert.equal(p.batches.flatMap(b => b.stationIds).length, 51);
  assert.equal(new Set(p.batches.flatMap(b => b.stationIds)).size, 51);
  for (const batch of p.batches) for (const id of batch.stationIds) assert.equal(batch.executionRegion, executionRegionForState(US_REGIONS[Number(id) - 1]));
});
test('ambiguous cross-region station identity stops catalog publishing', () => {
  const c = catalog(); c.regions.find(r => r.code === 'CA').ids = c.regions.find(r => r.code === 'FL').ids;
  assert.throws(() => planRegionalRefresh(c), /Ambiguous/);
});
test('same-region cross-state duplicates deduplicate, without double charging provider work', () => {
  const c = catalog(); c.regions.find(r => r.code === 'GA').ids = c.regions.find(r => r.code === 'FL').ids;
  assert.equal(planRegionalRefresh(c).stationCount, 50);
});
test('every wrong or missing execution region is rejected before collection', async () => {
  for (const expected of Object.keys(NATIONAL_REGIONS)) for (const actual of [...Object.keys(NATIONAL_REGIONS), undefined]) {
    if (expected === actual) continue;
    let called = false;
    const handler = createNationalRegionHandler({ expectedRegion: expected, actualRegion: actual, secret: 'test-only',
      collect: async () => { called = true; } });
    const response = await handler(request());
    assert.equal(response.status, actual ? 409 : 503); assert.equal(called, false);
  }
});
test('unauthorized regional invocation never touches database or provider', async () => {
  let called = false;
  const handler = createNationalRegionHandler({ expectedRegion: 'us-east-1', actualRegion: 'us-east-1', secret: 'test-only', collect: async () => { called = true; } });
  assert.equal((await handler(request({}, 'wrong'))).status, 401); assert.equal(called, false);
});
test('health verifies runtime geography without claiming jobs; collect passes only the verified runtime region', async () => {
  for (const actualRegion of Object.keys(NATIONAL_REGIONS)) {
    const calls = [];
    const handler = createNationalRegionHandler({ expectedRegion: actualRegion, actualRegion, secret: 'test-only', collect: async args => { calls.push(args); return []; } });
    const health = await handler(request({ mode: 'health' }));
    assert.equal(health.status, 200); assert.equal(calls.length, 0);
    assert.equal((await health.json()).actualRegion, actualRegion);
    const collected = await handler(request({ mode: 'collect', region: 'untrusted-input' }));
    assert.equal(collected.status, 200); assert.equal(calls.length, 1); assert.equal(calls[0].executionRegion, actualRegion);
  }
});
test('worker rejects a wrong-region job before making any provider request', async () => {
  const calls = []; let fetches = 0;
  const db = { rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'claim_fuel_national_region_job' ?
    [{ id: 1, execution_region: 'us-west-1', station_ids: ['1'], lease_token: 'token' }] : true }; } };
  const results = await collectNationalPrices({ db, executionRegion: 'us-east-1', fetchBatch: async () => { fetches++; } });
  assert.equal(fetches, 0); assert.equal(results[0].code, 'REGION_JOB_MISMATCH');
  assert.equal(calls[0].args.p_region, 'us-east-1'); assert.equal(calls[1].name, 'fail_fuel_national_job');
});
test('generic worker cannot run without a known execution region', async () => {
  await assert.rejects(collectNationalPrices({}), /EXECUTION_REGION_REQUIRED/);
});
