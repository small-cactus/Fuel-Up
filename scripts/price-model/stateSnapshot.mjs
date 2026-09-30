import { priceQuery, validatePriceBatch } from '../../supabase/functions/_shared/nationalPriceBatch.mjs';
export { priceQuery, validatePriceBatch };
// Research-only state collection. No app cache, ranking, or scheduled writes.
export const INVENTORY_QUERY = `query StateInventory($state:String!,$limit:Int!){
  locationBySearchTerm(search:$state,priority:"locality"){
    displayName countryCode regionCode
    stations(limit:$limit,maxAge:0,priority:"locality"){
      count results{id name latitude longitude address{line1 locality region postalCode country}}
    }
  }
}`;

export function validateInventory(data, region) {
  const location = data?.locationBySearchTerm;
  const code = value => typeof value === 'string' ? value.trim().toUpperCase() : null;
  if (code(location?.regionCode) !== region || (location.countryCode && code(location.countryCode) !== 'US')) {
    throw new Error(`Search resolved outside requested state ${region}`);
  }
  const { count, results } = location.stations || {};
  if (!Number.isSafeInteger(count) || count <= 0 || !Array.isArray(results)) throw new Error('Invalid inventory response');
  if (results.length !== count) throw new Error(`Incomplete inventory: ${results.length}/${count}`);
  const ids = new Set();
  for (const station of results) {
    if (typeof station.id !== 'string' || !station.id || ids.has(station.id)) throw new Error('Invalid or duplicate inventory ID');
    if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) throw new Error(`Invalid location for ${station.id}`);
    ids.add(station.id);
  }
  return results;
}

export function inventoryScopeWarnings(inventory, region) {
  const code = value => typeof value === 'string' ? value.trim().toUpperCase() : null;
  return inventory.filter(station => code(station.address?.region) !== region || code(station.address?.country) !== 'US')
    .map(station => ({ stationId: station.id, code: 'ADDRESS_SCOPE_MISMATCH',
      reportedRegion: station.address?.region ?? null, reportedCountry: station.address?.country ?? null }));
}

export async function fetchStateSnapshot({ state, region, request, batchSize = 2000, inventoryLimit = 10000,
  maxInventory = 10000, pauseMs = 2000, maxRequests = 100, sleep = ms => new Promise(r => setTimeout(r, ms)),
  now = () => Date.now(), onProgress = () => {} }) {
  if (typeof state !== 'string' || !state.trim() || !/^[A-Z]{2}$/.test(region)) throw new Error('State name and two-letter region required');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 2000) throw new Error('Batch size must be 1–2000');
  if (!Number.isSafeInteger(inventoryLimit) || !Number.isSafeInteger(maxInventory) || inventoryLimit < 1 || inventoryLimit > maxInventory || maxInventory > 10000) {
    throw new Error('Invalid inventory bounds');
  }
  if (!Number.isFinite(pauseMs) || pauseMs < 0 || !Number.isSafeInteger(maxRequests) || maxRequests < 1) throw new Error('Invalid request bounds');
  const started = now(), requests = [], stations = new Map();
  const call = async (kind, query, variables) => {
    if (requests.length >= maxRequests) throw new Error('Request budget exhausted; snapshot incomplete');
    if (requests.length) await sleep(pauseMs);
    const index = requests.length;
    requests.push({ kind });
    try {
      const response = await request(query, variables);
      requests[index] = { kind, ...response.metrics };
      return response;
    } catch (error) {
      requests[index] = { kind, error: error.message };
      throw error;
    }
  };
  let inventoryResponse = await call('inventory', INVENTORY_QUERY, { state, limit: inventoryLimit });
  const count = inventoryResponse.data?.locationBySearchTerm?.stations?.count;
  if (Number.isSafeInteger(count) && count > inventoryLimit) {
    if (count > maxInventory) throw new Error(`State inventory has ${count} records, beyond the ${maxInventory}-record verified search window; complete partitioned discovery is required before fetching prices`);
    inventoryResponse = await call('inventory-expanded', INVENTORY_QUERY, { state, limit: count });
  }
  const inventory = validateInventory(inventoryResponse.data, region);
  const ids = inventory.map(s => s.id);
  onProgress({ phase: 'inventory', count: ids.length, elapsedMs: now() - started });
  const getBatch = async batch => {
    let response;
    try { response = await call('prices', priceQuery(batch), {}); }
    catch (error) {
      // Split only payload-size errors. Never retry access/rate denials or
      // malformed/partial data as if they were a successful response.
      if (error.code !== 'PAYLOAD_TOO_LARGE' || batch.length <= 100) throw error;
      const midpoint = Math.ceil(batch.length / 2);
      await getBatch(batch.slice(0, midpoint));
      await getBatch(batch.slice(midpoint));
      return;
    }
    const rows = validatePriceBatch(response.data, batch);
    for (const station of rows) stations.set(station.id, { ...station,
      observedAt: response.metrics?.observedAt ?? new Date(now()).toISOString() });
    onProgress({ phase: 'prices', completed: stations.size, expected: ids.length, elapsedMs: now() - started });
  };
  for (let i = 0; i < ids.length; i += batchSize) await getBatch(ids.slice(i, i + batchSize));
  if (stations.size !== ids.length || ids.some(id => !stations.has(id))) throw new Error('Snapshot coverage mismatch');
  const rows = inventory.map(metadata => ({ ...metadata, ...stations.get(metadata.id) }));
  const pricedStations = rows.filter(s => s.prices.some(p => p.cash?.price > 0 || p.credit?.price > 0)).length;
  return { version: 1, provider: 'gasbuddy', state, region, complete: true,
    coverageBasis: 'Every ID in the provider inventory at collection start; not an atomic price snapshot or independently verified station census.',
    startedAt: new Date(started).toISOString(), finishedAt: new Date(now()).toISOString(),
    elapsedMs: now() - started, inventoryCount: ids.length, returnedCount: rows.length,
    pricedStations, unpricedStations: rows.length - pricedStations, requestCount: requests.length,
    pauseMs, batchSize, scopeWarnings: inventoryScopeWarnings(inventory, region), requests, stations: rows };
}
