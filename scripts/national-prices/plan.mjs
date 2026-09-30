// Planning is offline. A national catalog is a reviewed, dated provider inventory,
// never an assertion that every real-world station has a current reported price.
export const US_REGIONS = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

export function planNationalRefresh(catalog, { batchSize = 2000, requestGapSeconds = 2,
  requestSeconds = 3, approvedStationLookupsPerHour, now = Date.now() } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 2000) throw Error('Batch size must be 1–2000');
  if (!Number.isFinite(requestGapSeconds) || requestGapSeconds < 2 || !Number.isFinite(requestSeconds) || requestSeconds <= 0) throw Error('Invalid timing budget');
  if (!Array.isArray(catalog?.regions) || catalog.regions.length !== US_REGIONS.length) throw Error('Require all 50 states plus DC');
  const seenRegions = new Set(), ids = new Set();
  for (const region of catalog.regions) {
    if (!US_REGIONS.includes(region.code) || seenRegions.has(region.code)) throw Error('Invalid or duplicate region');
    seenRegions.add(region.code);
    const observed = Date.parse(region.observedAt);
    if (!region.complete || !region.coverageBasis || !Number.isFinite(observed) || observed < now - 86_400_000 || observed > now + 60_000) throw Error(`Unverified or stale catalog scope: ${region.code}`);
    if (!Array.isArray(region.ids) || !Number.isSafeInteger(region.expectedCount) || region.expectedCount < 1 ||
      region.ids.length !== region.expectedCount || new Set(region.ids).size !== region.expectedCount) throw Error(`Incomplete inventory: ${region.code}`);
    for (const id of region.ids) {
      if (typeof id !== 'string' || !/^\d{1,12}$/.test(id)) throw Error('Invalid provider station ID');
      ids.add(id);
    }
  }
  // Count station resolutions, not just HTTP envelopes. Thousands of aliases
  // do not convert thousands of upstream operations into one cheap lookup.
  const sorted = [...ids].sort((a, b) => Number(a) - Number(b));
  const batches = Array.from({ length: Math.ceil(sorted.length / batchSize) }, (_, i) => sorted.slice(i * batchSize, (i + 1) * batchSize));
  const budgetFits = Number.isSafeInteger(approvedStationLookupsPerHour) && approvedStationLookupsPerHour >= sorted.length;
  return { stationCount: sorted.length, regionCount: seenRegions.size, batchSize, batches,
    httpRequestsPerHour: batches.length, stationLookupsPerHour: sorted.length,
    estimatedSerialSeconds: batches.length * (requestSeconds + requestGapSeconds),
    estimatedScheduledSeconds: Math.max(batches.length * (requestSeconds + requestGapSeconds),
      Math.floor((batches.length - 1) / 8) * 60 + ((batches.length - 1) % 8 + 1) * (requestSeconds + requestGapSeconds)),
    estimateOnly: true, readyToEnable: budgetFits,
    blockingReason: budgetFits ? null : 'Provider station-lookup budget has not been established for this volume' };
}
