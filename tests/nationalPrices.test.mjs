import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { planNationalRefresh, US_REGIONS } from '../scripts/national-prices/plan.mjs';
import { fetchNationalPriceBatch, compressSnapshot, retryAfterSeconds, NationalPriceError } from '../supabase/functions/_shared/nationalPriceTransport.mjs';
import { collectNationalPrices } from '../supabase/functions/_shared/nationalPriceWorker.mjs';

const catalog = () => ({ regions: US_REGIONS.map((code, i) => ({ code, complete: true,
  coverageBasis: 'test fixture only', observedAt: new Date().toISOString(), expectedCount: 1, ids: [String(i + 1)] })) });
const quote = id => ({ id, prices: [{ fuelProduct: 'regular_gas', cash: { price: 3.29, postedTime: '2026-09-29T11:00:00Z' }, credit: null }] });

test('national planning deduplicates across states and budgets station resolutions, not envelopes', () => {
  const c = catalog(); c.regions[1].ids = ['1'];
  const p = planNationalRefresh(c, { approvedStationLookupsPerHour: 50 });
  assert.equal(p.stationCount, 50); assert.equal(p.httpRequestsPerHour, 1); assert.equal(p.stationLookupsPerHour, 50);
  assert.equal(p.readyToEnable, true); assert.equal(planNationalRefresh(c).readyToEnable, false);
});
test('national planning rejects missing states, duplicate states, unreconciled counts and unknown scope', () => {
  for (const alter of [c => c.regions.pop(), c => c.regions[1].code = 'AL',
    c => c.regions[0].expectedCount = 2, c => c.regions[0].complete = false,
    c => c.regions[0].coverageBasis = '', c => c.regions[0].ids = ['bad-id'],
    c => c.regions[0].observedAt = '2020-01-01T00:00:00Z']) {
    const c = catalog(); alter(c); assert.throws(() => planNationalRefresh(c));
  }
});
test('Retry-After handles seconds and HTTP dates, with no shortening to an arbitrary maximum', () => {
  assert.equal(retryAfterSeconds('7200'), 7200);
  assert.equal(retryAfterSeconds('Tue, 01 Sep 2026 00:30:00 GMT', Date.parse('2026-09-01T00:00:00Z')), 1800);
  assert.equal(retryAfterSeconds('unknown'), 0); assert.equal(retryAfterSeconds(null), 0);
});
test('national transport preserves exact raw quotes, absent prices, and separate observation time', async () => {
  const s = await fetchNationalPriceBatch(['1', '2'], { fetchImpl: async () => new Response(JSON.stringify({ data: { s0: quote('1'), s1: { id: '2', prices: [] } } })) });
  assert.deepEqual(s.stations, [quote('1'), { id: '2', prices: [] }]);
  assert.notEqual(s.observedAt, quote('1').prices[0].cash.postedTime);
  const gz = await compressSnapshot(s); assert.deepEqual(JSON.parse(gunzipSync(gz)), s);
});
test('national transport rejects partial data, silent alias reorder, HTTP200 GraphQL errors and oversized responses', async () => {
  for (const body of [{ data: { s0: null } }, { data: { s0: quote('2') } },
    { data: { s0: quote('1') }, errors: [{ message: 'rate limited' }] }]) {
    await assert.rejects(fetchNationalPriceBatch(['1'], { fetchImpl: async () => new Response(JSON.stringify(body)) }));
  }
  await assert.rejects(fetchNationalPriceBatch(['1'], { maxBytes: 2, fetchImpl: async () => new Response('larger') }), /BODY_TOO_LARGE/);
});
test('national transport captures 429 Retry-After and sends no retry', async () => {
  let calls = 0;
  await assert.rejects(fetchNationalPriceBatch(['1'], { fetchImpl: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '5400' } }); } }),
    error => error.code === 'UPSTREAM_HTTP_429' && error.retryAfterSeconds === 5400);
  assert.equal(calls, 1);
});

function fakeDB({ jobs = [{ id: 1, run_id: 10, lease_token: 'token', station_ids: ['1', '2'] }], save = true, uploadError = false } = {}) {
  const calls = [], uploads = [];
  jobs.forEach(job => job.execution_region = 'us-east-1');
  return { calls, uploads,
    rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'claim_fuel_national_region_job' ? (jobs.length ? [jobs.shift()] : []) : name === 'finish_fuel_national_job' ? save : true }; },
    storage: { from: bucket => ({ upload: async (path, bytes, options) => { uploads.push({ bucket, path, bytes, options }); return { error: uploadError ? 'failed' : null }; } }) } };
}
const snapshot = { startedAt: new Date().toISOString(), observedAt: new Date().toISOString(), stations: [quote('1'), { id: '2', prices: [] }] };
test('worker archives first, then commits exact IDs, checksum and unpriced coverage; never overwrites artifacts', async () => {
  const db = fakeDB(); const r = await collectNationalPrices({ executionRegion: 'us-east-1', db, fetchBatch: async () => snapshot, sleep: async () => {} });
  assert.equal(r[0].stations, 2); assert.equal(r[0].priced, 1);
  assert.equal(db.uploads[0].options.upsert, false);
  assert.deepEqual(JSON.parse(gunzipSync(db.uploads[0].bytes)), { ...snapshot, executionRegion: 'us-east-1' });
  const saved = db.calls.find(c => c.name === 'finish_fuel_national_job');
  assert.deepEqual(saved.args.p_ids, ['1', '2']); assert.equal(saved.args.p_priced, 1); assert.equal(saved.args.p_sha256.length, 64);
});
test('archive failure or stale lease cannot publish a successful batch', async () => {
  for (const option of [{ uploadError: true }, { save: false }]) {
    const db = fakeDB(option); const r = await collectNationalPrices({ executionRegion: 'us-east-1', db, fetchBatch: async () => snapshot });
    assert.equal(r[0].status, 'failed'); assert(db.calls.some(c => c.name === 'fail_fuel_national_job'));
    if (option.uploadError) assert(!db.calls.some(c => c.name === 'finish_fuel_national_job'));
  }
});
test('rate denial stops the worker loop immediately and persists the cooldown', async () => {
  const db = fakeDB(); let fetches = 0;
  const r = await collectNationalPrices({ executionRegion: 'us-east-1', db, fetchBatch: async () => { fetches++; throw new NationalPriceError('UPSTREAM_HTTP_429', 5000); } });
  assert.equal(fetches, 1); assert.equal(db.uploads.length, 0); assert.equal(r[0].status, 'failed');
  assert.equal(db.calls.at(-1).args.p_retry_after_seconds, 5000);
  assert.equal(db.calls.filter(c => c.name === 'claim_fuel_national_region_job').length, 1);
});
test('disabled or cooled queue causes zero provider calls and zero storage writes', async () => {
  const db = fakeDB({ jobs: [] }); let fetched = false;
  assert.deepEqual(await collectNationalPrices({ executionRegion: 'us-east-1', db, fetchBatch: async () => { fetched = true; } }), []);
  assert.equal(fetched, false); assert.equal(db.uploads.length, 0);
});
test('worker spaces provider calls and finishes its invocation before the next cron tick', async () => {
 let clock=0; const fetchedAt=[];
 const jobs=Array.from({length:8},(_,i)=>({id:i+1,run_id:10,lease_token:'token-'+i,station_ids:['1','2'],request_interval_seconds:15}));
 const db=fakeDB({jobs});
 const result=await collectNationalPrices({db,executionRegion:'us-east-1',now:()=>clock,sleep:async ms=>{clock+=ms;},fetchBatch:async()=>{fetchedAt.push(clock);clock+=3000;return snapshot;}});
 assert.deepEqual(fetchedAt,[0,15000,30000]);assert.equal(result.length,3);assert.equal(clock,45000);
});
