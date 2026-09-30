export function distanceKm(a,b) {
  const rad=Math.PI/180, lat1=a.latitude*rad,lat2=b.latitude*rad;
  const h=Math.sin((lat2-lat1)/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin((b.longitude-a.longitude)*rad/2)**2;
  return 6371.0088*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function reconcileDCGeography(observations,boundary,now=Date.now()) {
  const feature=boundary?.data?.features?.find(f=>f.properties.STUSAB==='DC');
  if(!feature) return null;
  const coordinates=feature.geometry.type==='Polygon'?feature.geometry.coordinates.flat():feature.geometry.coordinates.flat(2);
  if(!coordinates.length) return null;
  const circles=new Map();
  for(const observation of observations) {
    if(now-Date.parse(observation.observedAt)>=86400000 || Date.parse(observation.observedAt)>now+60000) continue;
    for(const scope of observation.scopes.filter(s=>s.state==='DC' && s.fullResponse)) {
      const center=scope.requestedCenter || {latitude:scope.location?.latitude,longitude:scope.location?.longitude};
      if(!Number.isFinite(center.latitude)||!Number.isFinite(center.longitude)) continue;
      const farthestKm=Math.max(...coordinates.map(([longitude,latitude])=>distanceKm(center,{latitude,longitude})));
      // 2 km margin inside the approximately 25 km footprint measured in NYC
      // and Clearwater. This is an explicit empirical API assumption.
      const farthestReturnedKm=Math.max(...scope.stations.map(s=>distanceKm(center,s)));
      if(farthestKm>23 || farthestReturnedKm<24) continue;
      const ids=[...new Set(scope.stations.filter(s=>String(s.address?.country).toUpperCase()==='US' && String(s.address?.region).toUpperCase()==='DC').map(s=>String(s.id)))].sort();
      if(!ids.length) continue;
      circles.set(`${center.latitude.toFixed(5)},${center.longitude.toFixed(5)}`,{center,farthestKm,farthestReturnedKm,ids,reportedCount:scope.reportedCount,observedAt:observation.observedAt});
    }
  }
  const candidates=[...circles.values()];
  for(let i=0;i<candidates.length;i++) for(let j=i+1;j<candidates.length;j++) {
    const a=candidates[i],b=candidates[j];
    if(distanceKm(a.center,b.center)<1 || JSON.stringify(a.ids)!==JSON.stringify(b.ids)) continue;
    return {code:'DC',complete:true,expectedCount:a.ids.length,ids:a.ids,
      observedAt:new Date(Math.min(Date.parse(a.observedAt),Date.parse(b.observedAt))).toISOString(),
      coverageBasis:'Geographic DC coverage: two complete nearby responses independently enclose the Census jurisdiction and return identical DC-addressed IDs; assumes the empirically observed approximately 25 km nearby footprint, not a provider-reported DC total',
      geographicEvidence:{boundarySource:boundary.source,assumedNearbyRadiusKm:25,boundaryMarginKm:2,centers:[a,b].map(({ids,...rest})=>rest)}};
  }
  return null;
}
