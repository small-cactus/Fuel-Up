import { planNationalRefresh } from './plan.mjs';
import { executionRegionForState, NATIONAL_REGIONS } from '../../supabase/functions/_shared/nationalRegions.mjs';

export function planRegionalRefresh(catalog, options = {}) {
  const base = planNationalRefresh(catalog, options), owners = new Map();
  const partitions = new Map(Object.keys(NATIONAL_REGIONS).map(region => [region, new Set()]));
  for (const state of catalog.regions) {
    const region = executionRegionForState(state.code);
    for (const id of state.ids) {
      if (owners.has(id) && owners.get(id) !== region) throw Error(`Ambiguous regional owner for station ${id}; reconcile its geography first`);
      owners.set(id, region); partitions.get(region).add(id);
    }
  }
  const batches = [];
  const regions = [...partitions].map(([executionRegion, ids]) => {
    const sorted = [...ids].sort((a, b) => Number(a) - Number(b));
    for (let i = 0; i < sorted.length; i += base.batchSize) batches.push({ executionRegion, stationIds: sorted.slice(i, i + base.batchSize) });
    return { executionRegion, stations: sorted.length, batches: Math.ceil(sorted.length / base.batchSize) };
  });
  // Scheduling visits one regional worker per tick, retaining the shared budget.
  return { ...base, batches, regions, httpRequestsPerHour: batches.length,
    estimatedScheduledSeconds: undefined, estimatedSerialSeconds: undefined };
}
