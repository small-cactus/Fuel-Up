import { reconcileDCGeography } from './geographicCoverage.mjs';
import { US_REGIONS } from './plan.mjs';
// Partial provider responses are useful evidence, never proof of state coverage.
// A partition union must reconcile to an actual provider-wide state count.
export function catalogFromDiscovery(observations, seeds = [], now = Date.now(), boundary = null) {
  const regions = [], gaps = [];
  const fresh = observations.filter(o=>Number.isFinite(Date.parse(o.observedAt)) && now-Date.parse(o.observedAt)<86400000 && Date.parse(o.observedAt)<=now+60000);
  for (const code of US_REGIONS) {
    const scopes = fresh.flatMap(o=>o.scopes.filter(s=>s.state===code).map(s=>({...s,observedAt:o.observedAt,kind:o.task.kind})));
    const whole = scopes.filter(s=>s.kind==='states' && s.scopeMatches).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));
    if (!whole.length) {
      const geographic = code === 'DC' ? reconcileDCGeography(fresh,boundary,now) : null;
      if(geographic) regions.push(geographic); else gaps.push({code,reason:'No verified statewide scope'});
      continue;
    }
    const expectedCount = whole[0].reportedCount;
    const full = whole.find(s=>s.fullResponse && s.returnedCount===expectedCount && s.stations.length===expectedCount);
    let ids, observedAt, coverageBasis;
    if(full) {
      ids=[...new Set(full.stations.map(s=>String(s.id)))]; observedAt=full.observedAt;
      coverageBasis='Complete provider state inventory; returned unique IDs equal reported count';
    } else {
      const candidates=scopes.filter(s=>(s.scopeMatches && (s.kind==='states' || s.kind==='brands' || s.kind==='fuels')) || s.kind==='nearby').map(s=>s.kind==='nearby' ? {...s,stations:s.stations.filter(x=>String(x.address?.country).toUpperCase()==='US' && String(x.address?.region).toUpperCase()===code)} : s);
      const stateSeeds=seeds.filter(s=>s.region===code && Number.isFinite(Date.parse(s.seedObservedAt)) && now-Date.parse(s.seedObservedAt)<86400000);
      ids=[...new Set([...candidates.flatMap(s=>s.stations.map(x=>String(x.id))),...stateSeeds.flatMap(s=>s.ids)])];
      observedAt=new Date(Math.min(...candidates.map(s=>Date.parse(s.observedAt)),...stateSeeds.map(s=>Date.parse(s.seedObservedAt)))).toISOString();
      coverageBasis='Union of provider state inventory, state-scoped brand and fuel partitions, and address-filtered geographic reconciliation, reconciled to latest statewide count';
    }
    if(!expectedCount || ids.length!==expectedCount) {
      gaps.push({code,reason:'Statewide count does not reconcile',expected:expectedCount,known:ids.length}); continue;
    }
    regions.push({code,complete:true,expectedCount,ids:ids.sort(),observedAt,coverageBasis});
  }
  return {complete:gaps.length===0,regions,gaps};
}
