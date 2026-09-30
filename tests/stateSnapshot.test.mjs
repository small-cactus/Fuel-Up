import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchStateSnapshot, validateInventory, validatePriceBatch, inventoryScopeWarnings } from '../scripts/price-model/stateSnapshot.mjs';
import { createSnapshotRequest } from '../scripts/price-model/stateSnapshotTransport.mjs';

const metadata = id => ({ id, name: id, latitude: 28, longitude: -82, address: { region: 'FL', country: 'US' } });
const quote = id => ({ id, prices: [{ fuelProduct: 'regular_gas', cash: { price: 3.1, postedTime: '2026-09-30T12:00:00Z' },
  credit: { price: 3.2, postedTime: '2026-09-30T13:00:00Z' } }] });
const inventory = ids => ({ locationBySearchTerm: { regionCode: 'FL', countryCode: 'US',
  stations: { count: ids.length, results: ids.map(metadata) } } });
const requestedIds = query => [...query.matchAll(/s\d+:station\(id:("(?:[^"\\]|\\.)*")\)/g)].map(m => JSON.parse(m[1]));
const defaults = { state: 'Florida', region: 'FL', sleep: async () => {} };

test('complete fixed-ID collection preserves identity, metadata and separate payment timestamps', async () => {
  const calls = [], pauses = [];
  const r = await fetchStateSnapshot({ ...defaults, batchSize: 2, sleep: async ms => pauses.push(ms),
    request: async (query, variables) => {
      calls.push({ query, variables });
      const ids = requestedIds(query);
      return { data: query.includes('StateInventory') ? inventory(['a', 'b', 'c']) :
        Object.fromEntries(ids.map((id, i) => [`s${i}`, id === 'c' ? { id, prices: [] } : quote(id)])) };
    } });
  assert.equal(r.complete, true); assert.equal(r.requestCount, 3);
  assert.deepEqual(pauses, [2000, 2000]);
  assert.deepEqual(r.stations.map(s => s.id), ['a', 'b', 'c']);
  assert.equal(r.pricedStations, 2); assert.equal(r.unpricedStations, 1);
  assert.deepEqual(r.stations[0].prices, quote('a').prices);
  assert.equal(r.stations[0].address.region, 'FL');
  assert.deepEqual(calls.slice(1).flatMap(c => requestedIds(c.query)), ['a', 'b', 'c']);
});

test('inventory validation refuses duplicates, truncated results, and wrong geocoded state', () => {
  assert.throws(() => validateInventory(inventory(['a', 'a']), 'FL'), /duplicate/);
  const truncated = inventory(['a']); truncated.locationBySearchTerm.stations.count = 2;
  assert.throws(() => validateInventory(truncated, 'FL'), /Incomplete/);
  assert.throws(() => validateInventory(inventory(['a']), 'CA'), /outside/);
});

test('inconsistent station address is retained and flagged, not silently dropped from state inventory', () => {
  const wrongAddress = inventory(['a']); wrongAddress.locationBySearchTerm.stations.results[0].address.region = 'GA';
  const rows = validateInventory(wrongAddress, 'FL');
  assert.equal(rows.length, 1);
  assert.deepEqual(inventoryScopeWarnings(rows, 'FL'), [{ stationId: 'a', code: 'ADDRESS_SCOPE_MISMATCH', reportedRegion: 'GA', reportedCountry: 'US' }]);
});

test('coverage validator rejects missing IDs, aliases swapped, partial prices, extra data', () => {
  assert.throws(() => validatePriceBatch({ s0: quote('a') }, ['a', 'b']), /Missing/);
  assert.throws(() => validatePriceBatch({ s0: quote('b'), s1: quote('a') }, ['a', 'b']), /mismatched/);
  assert.throws(() => validatePriceBatch({ s0: null }, ['a']), /Missing/);
  assert.throws(() => validatePriceBatch({ s0: { id: 'a' } }, ['a']), /Missing/);
  assert.throws(() => validatePriceBatch({ s0: quote('a'), s1: quote('b') }, ['a']), /extra/);
});

test('provider mixed-case state abbreviations validate without changing raw metadata', () => {
  const d = inventory(['a']);d.locationBySearchTerm.stations.results[0].address.region = 'Fl';
  assert.equal(validateInventory(d, 'FL')[0].address.region, 'Fl');
});

test('zero and absent reports remain unpriced rather than disappearing from coverage', () => {
  const row = { id: 'a', prices: [{ fuelProduct: 'diesel', cash: null, credit: { price: 0, postedTime: null } }] };
  assert.deepEqual(validatePriceBatch({ s0: row }, ['a']), [row]);
});

test('payload-size failures split bounded batches and still cover every requested ID once', async () => {
  const successful = []; let split = false;
  const r = await fetchStateSnapshot({ ...defaults, batchSize: 200, request: async query => {
    if (query.includes('StateInventory')) return { data: inventory(Array.from({ length: 150 }, (_, i) => String(i))) };
    const ids = requestedIds(query);
    if (ids.length > 100) { split = true; throw Object.assign(new Error('too large'), { code: 'PAYLOAD_TOO_LARGE' }); }
    successful.push(...ids);return { data: Object.fromEntries(ids.map((id, i) => [`s${i}`, quote(id)])) };
  } });
  assert(split); assert.equal(r.returnedCount, 150); assert.equal(new Set(successful).size, 150);
  assert.equal(successful.length, 150);
});

test('access denial stops the run with no retry or subsequent batch', async () => {
  let calls = 0;
  await assert.rejects(fetchStateSnapshot({ ...defaults, batchSize: 1, request: async query => {
    calls++;
    if (query.includes('StateInventory')) return { data: inventory(['a', 'b']) };
    throw Object.assign(new Error('HTTP 429'), { code: 'ACCESS_OR_RATE_DENIAL' });
  } }), /429/);
  assert.equal(calls, 2);
});

test('larger inventory can be retrieved within budget, without cursor paging', async () => {
  const limits = [];
  const r = await fetchStateSnapshot({ ...defaults, inventoryLimit: 1, request: async (query, variables) => {
    if (query.includes('StateInventory')) {
      limits.push(variables.limit);const d = inventory(['a', 'b']);
      if (variables.limit === 1) d.locationBySearchTerm.stations.results.pop();
      return { data: d };
    }
    return { data: { s0: quote('a'), s1: quote('b') } };
  } });
  assert.deepEqual(limits, [1, 2]);assert.equal(r.returnedCount, 2);
});

test('request budget exhaustion cannot report a complete snapshot', async () => {
  await assert.rejects(fetchStateSnapshot({ ...defaults, maxRequests: 1,
    request: async () => ({ data: inventory(['a']) }) }), /budget exhausted/);
});

test('states beyond the verified inventory window stop before fetching incomplete prices', async () => {
  let calls = 0;
  await assert.rejects(fetchStateSnapshot({ ...defaults, request: async () => {
    calls++; const d = inventory(['a']);d.locationBySearchTerm.stations.count = 15271;return { data: d };
  } }), /partitioned discovery/);
  assert.equal(calls, 1);
});

test('transport rejects GraphQL errors even when HTTP status is 200 and partial data exists', async () => {
  const request = createSnapshotRequest({ fetchImpl: async () => new Response(JSON.stringify({ data: { s0: quote('a') },
    errors: [{ message: 'field failed' }] })) });
  await assert.rejects(request('{x}', {}), error => error.code === 'GRAPHQL_ERROR');
});

test('transport preserves rate-denial classification and bounded response size', async () => {
  const denied = createSnapshotRequest({ fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '60' } }) });
  await assert.rejects(denied('{x}', {}), error => error.code === 'ACCESS_OR_RATE_DENIAL' && error.message.includes('60'));
  const large = createSnapshotRequest({ maxResponseBytes: 5, fetchImpl: async () => new Response('{"data":{}}') });
  await assert.rejects(large('{x}', {}), error => error.code === 'PAYLOAD_TOO_LARGE');
});
