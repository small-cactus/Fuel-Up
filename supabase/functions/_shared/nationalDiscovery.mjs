import { buildGasBuddyGraphQLRequest } from './core.mjs';
import { providerResponseEvidence } from './providerResponseEvidence.mjs';
import { executionRegionForState } from './nationalRegions.mjs';
import { NationalPriceError, retryAfterSeconds } from './nationalPriceTransport.mjs';

export const STATE_NAMES = Object.fromEntries([
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York State'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
]);
const selection = 'count results{id latitude longitude address{region country}}';
const locationFields = 'displayName regionCode countryCode latitude longitude';

export function discoveryQuery(task, region) {
  const stateAllowed = state => { if (!STATE_NAMES[state] || executionRegionForState(state) !== region) throw new NationalPriceError('DISCOVERY_REGION_MISMATCH'); };
  if (task.kind === 'states') {
    if (!Array.isArray(task.states) || !task.states.length || task.states.length > 4 || new Set(task.states).size !== task.states.length) throw new NationalPriceError('INVALID_DISCOVERY_STATES');
    task.states.forEach(stateAllowed);
    if (task.searchStyle && !['name','code','qualified'].includes(task.searchStyle)) throw new NationalPriceError('INVALID_SEARCH_STYLE');
    const searchFor = state => task.searchStyle === 'name' ? STATE_NAMES[state] : task.searchStyle === 'code' ? state : STATE_NAMES[state] + ', United States';
    return `query NationalInventory{${task.states.map((state, i) => `s${i}:locationBySearchTerm(search:${JSON.stringify(searchFor(state))},priority:"locality"){${locationFields} stations(limit:10000,maxAge:0,priority:"locality"){${selection}}}`).join(' ')}}`;
  }
  stateAllowed(task.state);
  if (task.kind === 'brands') {
    if (!Array.isArray(task.brandIds) || !task.brandIds.length || task.brandIds.length > 8 || task.brandIds.some(id => !Number.isInteger(id) || id < 0 || id > 100000)) throw new NationalPriceError('INVALID_DISCOVERY_BRANDS');
    return `query BrandInventory{scope:locationBySearchTerm(search:${JSON.stringify(STATE_NAMES[task.state] + ', United States')},priority:"locality"){${locationFields} ${task.brandIds.map((id, i) => `s${i}:stations(brandId:${id},limit:10000,maxAge:0,priority:"locality"){${selection}}`).join(' ')}}}`;
  }
  if (task.kind === 'nearby') {
    // Targeted reconciliation only. Bounds prevent a task assigned to East from
    // querying western states; Texas points are generated inside its polygon.
    const bounds = task.state === 'TX' ? [25.8,36.6,-106.7,-93.4] : task.state === 'DC' ? [38.8,39,-77.12,-76.9] : null;
    if (!bounds || !Number.isFinite(task.latitude) || !Number.isFinite(task.longitude) || task.latitude < bounds[0] || task.latitude > bounds[1] || task.longitude < bounds[2] || task.longitude > bounds[3]) throw new NationalPriceError('INVALID_DISCOVERY_COORDINATE');
    return `query NearbyInventory{scope:locationBySearchTerm(lat:${task.latitude},lng:${task.longitude},priority:"locality"){${locationFields} stations(lat:${task.latitude},lng:${task.longitude},limit:10000,maxAge:0,priority:"locality"){${selection}}}}`;
  }
  throw new NationalPriceError('INVALID_DISCOVERY_KIND');
}

export function normalizeDiscovery(data, task, executionRegion) {
  const scopes = task.kind === 'states' ? task.states.map((state, i) => ({ state, location: data?.[`s${i}`], rows: data?.[`s${i}`]?.stations })) :
    task.kind === 'brands' ? task.brandIds.map((brandId, i) => ({ state: task.state, brandId, location: data?.scope, rows: data?.scope?.[`s${i}`] })) :
      [{ state: task.state, location: data?.scope, rows: data?.scope?.stations }];
  return { task, executionRegion, observedAt: new Date().toISOString(), scopes: scopes.map(({ state, brandId, location, rows }) => {
    if (!location || !Number.isSafeInteger(rows?.count) || rows.count < 0 || !Array.isArray(rows.results)) throw new NationalPriceError('DISCOVERY_SCHEMA_ERROR');
    const ids = new Set();
    for (const s of rows.results) {
      if (!/^\d{1,12}$/.test(s.id) || ids.has(s.id) || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) throw new NationalPriceError('DISCOVERY_ID_OR_GEOMETRY_ERROR');
      ids.add(s.id);
    }
    return { state, ...(brandId !== undefined ? { brandId } : {}), reportedCount: rows.count, returnedCount: ids.size,
      fullResponse: ids.size === rows.count, scopeMatches: String(location.countryCode).toUpperCase() === 'US' && String(location.regionCode).toUpperCase() === state,
      location: { displayName: location.displayName, countryCode: location.countryCode, regionCode: location.regionCode, latitude: location.latitude, longitude: location.longitude }, stations: rows.results };
  }) };
}

export async function fetchDiscovery(task, executionRegion, { csrf, fetchImpl = fetch } = {}) {
  const query = discoveryQuery(task, executionRegion);
  const started = performance.now();
  const { url, headers } = buildGasBuddyGraphQLRequest({ latitude: 0, longitude: 0 });
  const response = await fetchImpl(url, { method: 'POST', headers: { ...headers, ...(csrf ? { gbcsrf: csrf } : {}) },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(25000) });
  const responseEvidence = providerResponseEvidence(response, performance.now() - started);
  if (!response.ok) { await response.body?.cancel(); const error = new NationalPriceError(`UPSTREAM_HTTP_${response.status}`, retryAfterSeconds(response.headers.get('retry-after'))); error.responseEvidence = responseEvidence; throw error; }
  if (!response.body) throw new NationalPriceError('EMPTY_RESPONSE');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 8_000_000) { await reader.cancel(); throw new NationalPriceError('DISCOVERY_BODY_TOO_LARGE'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (payload.errors?.length) { const error = new NationalPriceError('DISCOVERY_GRAPHQL_ERROR');
    error.responseEvidence = { ...responseEvidence, graphqlErrors: payload.errors.map(e => String(e.message).slice(0, 500)).slice(0, 10) }; throw error; }
  return { ...normalizeDiscovery(payload.data, task, executionRegion), responseEvidence };
}

export async function collectDiscovery({ db, executionRegion, csrf, fetchSnapshot = fetchDiscovery }) {
  const claim = await db.rpc('claim_fuel_discovery_job', { p_region: executionRegion });
  if (claim.error) { console.error('Discovery claim failed', { code: claim.error.code, message: claim.error.message }); const error = new NationalPriceError('DISCOVERY_CLAIM_FAILED'); error.databaseCode = claim.error.code; throw error; }
  const job = claim.data?.[0]; if (!job) return [];
  try {
    if (job.execution_region !== executionRegion) throw new NationalPriceError('DISCOVERY_REGION_MISMATCH');
    const payload = await fetchSnapshot(job.descriptor, executionRegion, { csrf });
    const saved = await db.rpc('finish_fuel_discovery_job', { p_id: job.id, p_token: job.lease_token, p_payload: payload });
    if (saved.error || !saved.data) throw new NationalPriceError('DISCOVERY_SAVE_FAILED');
    return [{ id: job.id, status: 'succeeded', scopes: payload.scopes.map(s => ({ state: s.state, count: s.returnedCount, expected: s.reportedCount })) }];
  } catch (error) {
    const code = error instanceof NationalPriceError ? error.code : 'DISCOVERY_NETWORK_OR_RUNTIME_ERROR';
    // Diagnostic storage must never prevent the mandatory cooldown write.
    let evidenceSaved;
    if (error.responseEvidence) {
      try {
        const evidence = await db.rpc('record_fuel_discovery_response', { p_id: job.id, p_token: job.lease_token, p_evidence: error.responseEvidence });
        evidenceSaved = !evidence.error && evidence.data === true;
      } catch { evidenceSaved = false; }
    }
    const failed = await db.rpc('fail_fuel_discovery_job', { p_id: job.id, p_token: job.lease_token, p_code: code, p_retry_after_seconds: error.retryAfterSeconds || 0 });
    if (failed.error) throw new NationalPriceError('DISCOVERY_FAILURE_SAVE_FAILED');
    return [{ id: job.id, status: 'failed', code, ...(evidenceSaved === false ? { evidenceSaved } : {}) }];
  }
}
