import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryQuery, normalizeDiscovery, fetchDiscovery, collectDiscovery } from '../supabase/functions/_shared/nationalDiscovery.mjs';
import { createNationalRegionHandler } from '../supabase/functions/_shared/nationalRegionHandler.mjs';
const task = { kind: 'states', states: ['FL'] };
const data = { s0: { countryCode: 'US', regionCode: 'FL', stations: { count: 1, results: [{ id: '123', latitude: 28, longitude: -82, address: { region: 'FL', country: 'US' } }] } } };
test('inventory query refuses mixed geographic ownership before network access', () => {
  assert.match(discoveryQuery(task, 'us-east-1'), /Florida/);
  assert.throws(() => discoveryQuery({ kind: 'states', states: ['FL','CA'] }, 'us-east-1'));
  assert.throws(() => discoveryQuery({ kind: 'brands', state: 'CA', brandIds: [1] }, 'us-east-1'));
  assert.throws(() => discoveryQuery({ kind: 'nearby', state: 'TX', latitude: 37, longitude: -122 }, 'us-east-1'));
});
test('partial inventory is explicit evidence, never silently complete', () => {
  const input = structuredClone(data); input.s0.stations.count = 10001;
  const result = normalizeDiscovery(input, task, 'us-east-1');
  assert.equal(result.scopes[0].fullResponse, false);
  assert.equal(result.scopes[0].reportedCount, 10001);
  assert.equal(result.scopes[0].returnedCount, 1);
});
test('duplicate station IDs and missing geometry fail collection', () => {
  const duplicate = structuredClone(data); duplicate.s0.stations.results.push(duplicate.s0.stations.results[0]);
  assert.throws(() => normalizeDiscovery(duplicate, task, 'us-east-1'));
  const missing = structuredClone(data); delete missing.s0.stations.results[0].latitude;
  assert.throws(() => normalizeDiscovery(missing, task, 'us-east-1'));
});
test('HTTP 429 captures Retry-After and never retries in the transport', async () => {
  let calls = 0;
  await assert.rejects(fetchDiscovery(task, 'us-east-1', { fetchImpl: async () => {
    calls++; return new Response('', { status: 429, headers: { 'Retry-After': '7200' } });
  } }), error => error.code === 'UPSTREAM_HTTP_429' && error.retryAfterSeconds === 7200);
  assert.equal(calls, 1);
});
test('successful discovery keeps the exact request identity and actual execution region', async () => {
  const result = await fetchDiscovery(task, 'us-east-1', { fetchImpl: async () => new Response(JSON.stringify({ data })) });
  assert.deepEqual(result.task, task); assert.equal(result.executionRegion, 'us-east-1');
  assert.equal(result.scopes[0].fullResponse, true);
});
test('worker cannot fetch a job belonging to another region', async () => {
  let fetched = false; const calls = [];
  const db = { rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'claim_fuel_discovery_job' ?
    [{ id: 1, descriptor: task, execution_region: 'us-west-1', lease_token: 'test' }] : true }; } };
  const result = await collectDiscovery({ db, executionRegion: 'us-east-1', fetchSnapshot: async () => { fetched = true; } });
  assert.equal(fetched, false); assert.equal(result[0].code, 'DISCOVERY_REGION_MISMATCH');
  assert.equal(calls[1].name, 'fail_fuel_discovery_job');
});
test('regional handler verifies actual region before discovery', async () => {
  let calls = 0;
  const handler = createNationalRegionHandler({ expectedRegion: 'us-east-1', actualRegion: 'us-west-2', secret: 'test', discover: async () => { calls++; } });
  const response = await handler(new Request('https://example.test', { method: 'POST', headers: { 'x-fuel-research-key': 'test' }, body: JSON.stringify({ mode: 'discover' }) }));
  assert.equal(response.status, 409); assert.equal(calls, 0);
});
test('diagnostic write failure cannot suppress mandatory 429 cooldown', async () => {
  const calls=[];
  const db={rpc:async(name,args)=>{calls.push({name,args});
    if(name==='claim_fuel_discovery_job') return {data:[{id:1,descriptor:task,execution_region:'us-east-1',lease_token:'test'}]};
    if(name==='record_fuel_discovery_response') throw Error('diagnostic store unavailable');
    return {data:true};
  }};
  const result=await collectDiscovery({db,executionRegion:'us-east-1',fetchSnapshot:async()=>fetchDiscovery(task,'us-east-1',{fetchImpl:async()=>new Response('',{status:429,headers:{'Retry-After':'60','Set-Cookie':'private-cookie'}})})});
  assert.equal(calls.at(-1).name,'fail_fuel_discovery_job');
  assert.equal(calls.at(-1).args.p_retry_after_seconds,60);
  assert.equal(result[0].evidenceSaved,false);
  assert.equal(calls.find(c=>c.name==='record_fuel_discovery_response').args.p_evidence.headers['set-cookie'],undefined);
});
test('scope reconciliation only permits explicit canonical state search variants', () => {
 assert.match(discoveryQuery({kind:'states',states:['CT'],searchStyle:'name'},'us-east-1'),/search:"Connecticut"/);
 assert.match(discoveryQuery({kind:'states',states:['CT'],searchStyle:'code'},'us-east-1'),/search:"CT"/);
 assert.throws(()=>discoveryQuery({kind:'states',states:['CT'],searchStyle:'arbitrary'},'us-east-1'));
});
