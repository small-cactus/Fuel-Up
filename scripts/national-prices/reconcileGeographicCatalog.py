"""Offline geographic inventory certification. Requires Shapely 2.1.2 + NumPy.
Never changes the provider's reported count, calls it, or publishes a catalog.
"""
import gzip, hashlib, json, math, sys
from datetime import datetime, timezone
import numpy as np
from shapely.geometry import shape, Point
from shapely.ops import transform, unary_union

def certify(observations, partial, boundary, seed, now=None):
    now = now or datetime.now(timezone.utc)
    def fresh(value):
        age = (now - datetime.fromisoformat(value.replace('Z', '+00:00'))).total_seconds()
        return -60 <= age < 86400
    polygon = shape(next(f['geometry'] for f in boundary['data']['features'] if f['properties']['STUSAB'] == 'TX'))
    xscale = 111.195 * math.cos(math.radians(31))
    yscale = 111.195
    projected = transform(lambda x,y: (np.asarray(x)*xscale, np.asarray(y)*yscale), polygon)
    circles, stations, receipts, timestamps = [], {}, [], []
    known = set(seed['ids']) if fresh(seed['seedObservedAt']) else set()
    reported = []
    for observation in observations:
        if not fresh(observation['observedAt']):
            continue
        for scope in observation['scopes']:
            if scope['state'] != 'TX':
                continue
            kind = observation['task']['kind']
            if kind in ('states','brands','fuels') and scope['scopeMatches']:
                known.update(s['id'] for s in scope['stations'])
                if kind == 'states':
                    reported.append((observation['observedAt'], scope['reportedCount']))
            if kind != 'nearby':
                continue
            if observation['executionRegion'] != 'us-east-1':
                raise ValueError('Wrong execution region')
            if not scope['fullResponse'] or len({s['id'] for s in scope['stations']}) != scope['reportedCount']:
                raise ValueError('Incomplete geographic response')
            center = scope['requestedCenter']
            point = Point(center['longitude'], center['latitude'])
            if not polygon.buffer(0.000002).covers(point):
                raise ValueError('Query center outside Texas')
            circles.append(Point(point.x*xscale,point.y*yscale).buffer(23,quad_segs=24))
            timestamps.append(observation['observedAt'])
            for station in scope['stations']:
                if polygon.covers(Point(station['longitude'],station['latitude'])):
                    stations[station['id']] = station
            receipts.append({'center':center,'reportedCount':scope['reportedCount'],'observedAt':observation['observedAt']})
    if not circles or not reported:
        raise ValueError('Missing geography or reported state count')
    uncovered = projected.difference(unary_union(circles)).area
    if uncovered > 0.000001:
        raise ValueError('Geographic coverage has gaps')
    if known - stations.keys():
        raise ValueError('Geography omits known state-scoped IDs')
    provider_count = sorted(reported)[-1][1]
    if len(stations) < provider_count:
        raise ValueError('Geographic inventory below reported state count')
    ids = sorted(stations)
    evidence = {'boundarySource':boundary['source'],'projectedCoverageRadiusKm':23,
        'assumedNearbyRadiusKm':25,'uncoveredSquareKm':uncovered,'completeQueryCount':len(receipts),
        'containsEveryStateScopedID':True,'stateScopedIDCount':len(known),
        'providerReportedCount':provider_count,'geographicCount':len(ids),'countDiscrepancy':len(ids)-provider_count,
        'idSetSha256':hashlib.sha256(('\n'.join(ids)+'\n').encode()).hexdigest(),
        'receipts':receipts}
    texas = {'code':'TX','complete':True,'expectedCount':len(ids),'ids':ids,'observedAt':min(timestamps),
        'coverageBasis':'Complete geographic sweep covering the Census Texas polygon with conservative 23 km projected circles inside the empirically observed approximately 25 km nearby footprint. Every response is complete and every state-scoped ID is included. The inconsistent provider statewide aggregate is retained separately, not substituted for the returned ID count.',
        'geographicEvidence':evidence}
    if any(r['code']=='TX' for r in partial['regions']) or any(g['code']!='TX' for g in partial['gaps']):
        raise ValueError('Expected only the Texas count discrepancy to remain')
    return {**partial,'regions':sorted(partial['regions']+[texas],key=lambda r:r['code']),'gaps':[],'complete':True}, evidence

if __name__ == '__main__':
    observations = json.load(open(sys.argv[1]))
    partial = json.load(open(sys.argv[2]))
    boundary = json.load(gzip.open('docs/research/2026-09-30-national-prices/census-dc-tx-boundaries.json.gz'))
    seed = json.load(gzip.open('docs/research/2026-09-30-national-prices/partial-texas-catalog.json.gz'))
    catalog,evidence = certify(observations,partial,boundary,seed)
    with open(sys.argv[3],'x') as output:
        json.dump(catalog,output,separators=(',',':'))
    print(json.dumps({k:v for k,v in evidence.items() if k not in ('receipts','boundarySource')}))
