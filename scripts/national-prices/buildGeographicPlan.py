"""Offline one-time inventory reconciliation; never contacts the price provider.
Run with Python + shapely==2.1.2 and numpy. Census geometry stays in the artifact.
"""
import gzip,json,math,sys
import numpy as np
from shapely.geometry import shape,Point
from shapely.ops import transform,nearest_points,unary_union
source=json.load(gzip.open('docs/research/2026-09-30-national-prices/census-dc-tx-boundaries.json.gz','rt'))
observations=json.load(open(sys.argv[1]))
state=sys.argv[2]
feature=next(f for f in source['data']['features'] if f['properties']['STUSAB']==state)
raw=shape(feature['geometry'])
xscale=111.195*math.cos(math.radians(31));yscale=111.195
project=lambda x,y:(np.asarray(x)*xscale,np.asarray(y)*yscale)
unproject=lambda x,y:(np.asarray(x)/xscale,np.asarray(y)/yscale)
poly=transform(project,raw)
if state=='DC':
 c=raw.centroid
 candidates=[Point(c.x-.012,c.y),Point(c.x+.012,c.y)]
 assert all(raw.contains(p) for p in candidates)
 centers=[(p.x*xscale,p.y*yscale) for p in candidates]
 residual=0
else:
 # The conservative projection radius stays below 25 geodesic km even at the
 # southern edge of Texas. Hexagon spacing is smaller than sqrt(3)*radius.
 radius=23.0;spacing=38.0;dy=spacing*math.sqrt(3)/2
 inner=poly.buffer(-0.05)
 lo,bot,hi,top=poly.bounds
 centers=[]
 for row,y in enumerate(np.arange(bot-dy,top+dy,dy)):
  for x in np.arange(lo-spacing,hi+spacing,spacing):
   p=Point(x+(spacing/2 if row%2 else 0),y)
   if p.distance(poly)>radius:continue
   if not inner.covers(p):p=nearest_points(inner,p)[0]
   if all(p.distance(Point(c))>1 for c in centers):centers.append((p.x,p.y))
 cover=unary_union([Point(c).buffer(radius,quad_segs=24) for c in centers])
 remaining=poly.difference(cover)
 while remaining.area>1e-6:
  p=remaining.representative_point();centers.append((p.x,p.y))
  cover=cover.union(p.buffer(radius,quad_segs=24));remaining=poly.difference(cover)
  if len(centers)>1500:raise RuntimeError('Coverage failed to converge')
 residual=remaining.area
 known={str(s['id']):s for o in observations for scope in o['scopes'] if scope['state']=='TX' for s in scope['stations'] if str(s.get('address',{}).get('region','')).upper()=='TX'}
 points=np.array([[s['longitude']*xscale,s['latitude']*yscale] for s in known.values()])
 matrix=np.sum((np.array(centers)[:,None,:]-points[None,:,:])**2,axis=2)<radius**2
 # Densest uncovered station groups first; keeps speculative empty-area work
 # at the end, which can be canceled when the statewide ID count reconciles.
 ordered=[];remaining_indices=set(range(len(centers)));uncovered=np.ones(len(points),dtype=bool)
 while remaining_indices:
  scores=np.sum(matrix & uncovered,axis=1)
  i=max(remaining_indices,key=lambda n:(int(scores[n]),int(matrix[n].sum()),-n))
  ordered.append(centers[i]);uncovered[matrix[i]]=False;remaining_indices.remove(i)
 centers=ordered
points=[{'latitude':round(y/yscale,6),'longitude':round(x/xscale,6)} for x,y in centers]
assert all(raw.buffer(0.000002).covers(Point(p['longitude'],p['latitude'])) for p in points)
plan={'state':state,'source':source['source'],'method':'Census polygon coverage with conservative projected 23 km circles; provider footprint remains an empirical approximately 25 km assumption',
 'pointCount':len(points),'uncoveredSquareKm':residual,'batches':[{'kind':'nearby','state':state,'points':points[i:i+8]} for i in range(0,len(points),8)]}
with open(sys.argv[3],'x') as f:json.dump(plan,f)
print(json.dumps({k:v for k,v in plan.items() if k not in ['batches','source']}))
