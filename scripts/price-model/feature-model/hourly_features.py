"""Regular query-time sampling, including aging quotes between source updates.

The feature formulas deliberately match prospective/features.py. This separate
task keeps the original frozen event-sampling benchmark unchanged.
"""
import argparse, hashlib, json, warnings
from pathlib import Path
import numpy as np
from sklearn.neighbors import BallTree
warnings.filterwarnings('ignore', message='All-NaN slice encountered')
TRAIN_END=72.0
HOLDOUT_START=120.0
CONTEXT=24

def source_events(price, source, observed):
    # Conflicting reports at exactly the same source time are excluded entirely.
    valid=np.isfinite(price)&np.isfinite(source)&np.isfinite(observed)&(price>0)&(source<=observed+5/60)
    times={}; conflicts=set()
    for t in np.flatnonzero(valid):
        stamp=float(source[t])
        if stamp in times and abs(float(price[t])-float(price[times[stamp]]))>1e-5: conflicts.add(stamp)
        else: times.setdefault(stamp,int(t))
    return sorted(t for stamp,t in times.items() if stamp not in conflicts),len(conflicts)

def label_pairs(events, source, observed):
    for k,t in enumerate(events):
        for u in events[k+1:]:
            if observed[u]-observed[t]>24: break
            if source[u]>source[t]+5/60:
                yield k,t,u
                break

def split_for(at, target_at):
    if at<TRAIN_END and target_at<TRAIN_END: return 0
    if TRAIN_END<=at<target_at<HOLDOUT_START: return 1
    return -1

FEATURES=['raw_price','report_age','observed_hour_sin','observed_hour_cos','day_sin','day_cos',
 'state','grade','payment','latitude','longitude','history_reports','hours_since_first',
 'history_price_mean_delta','history_price_std','history_change_rate','hours_since_last_change',
 'state_median_delta','state_move_6h','state_move_24h','local_median_delta','local_peer_count',
 'local_move_6h','local_move_24h','prior_quote_missing']
for lag in [1,2,3,4,6,8]: FEATURES += [f'event_delta_{lag}',f'event_elapsed_{lag}']
for lag in [1,3,6,12,24]: FEATURES += [f'hour_delta_{lag}',f'hour_present_{lag}']

def query_pairs(events,source,observed,price,station,period=12):
    stamps={float(source[t]) for t in events}
    for t in range(station % period,len(price),period):
        if not(np.isfinite(price[t]) and np.isfinite(source[t]) and np.isfinite(observed[t])):continue
        if source[t]>observed[t]+5/60 or float(source[t]) not in stamps:continue
        hist=[v for v in events if v<=t]
        if not hist:continue
        future=[v for v in events if v>t and 0<observed[v]-observed[t]<=24 and source[v]>source[t]+5/60]
        yield len(hist)-1,t,future[0] if future else None


def build(root,shard=0,shards=1,from_hour=None,sampling='query'):
    a=root/'arrays'; m=json.loads((a/'metadata.json').read_text())
    assert float(m['start_hour'])+m['shape'][0]<=HOLDOUT_START+1
    p=np.load(a/'prices.npy',mmap_mode='r');s=np.load(a/'sources.npy',mmap_mode='r');o=np.load(a/'observed.npy',mmap_mode='r')
    states=sorted(set(m['states']));state=np.array([states.index(x) for x in m['states']])
    T,N,C=p.shape; index={sid:i for i,sid in enumerate(m['ids'])}
    geo=np.full((N,2),np.nan,dtype='float32')
    for row in json.loads((root/'geography.json').read_text()):
        if row['station_id'] in index: geo[index[row['station_id']]]=[row['latitude'],row['longitude']]
    validgeo=np.flatnonzero(np.isfinite(geo).all(1));neighbors=np.full((N,16),-1,dtype='int32')
    if len(validgeo)>17:
        tree=BallTree(np.radians(geo[validgeo]));dist,near=tree.query(np.radians(geo[validgeo]),k=17)
        # Exclude self, bound geographic comparisons to six miles.
        ids=validgeo[near[:,1:]];ids[dist[:,1:]*3958.8>6]=-1;neighbors[validgeo]=ids
    cities=json.loads((Path(__file__).resolve().parents[1]/'collection-cities.json').read_text())
    if isinstance(cities,dict): cities=cities.get('cities',cities)
    panel={}
    for ci,city in enumerate(cities):
        point=np.radians([[city['latitude'],city['longitude']]])
        for i in validgeo[tree.query_radius(point,r=6/3958.8)[0]]: panel.setdefault(int(i),ci)
    market=np.full((T,len(states),C),np.nan,dtype='float32')
    for st in range(len(states)):
        market[:,st,:]=np.nanmedian(p[:,state==st,:],axis=1)
    out=root/'dataset';out.mkdir(exist_ok=True)
    stats={'source_events':0,'conflicting_sources':0,'no_target':0,'purged':0,'train':0,'validation':0,'train_changes_10c':0,'validation_changes_10c':0,'query_candidates':0}
    for lo in list(range(0,N,512))[shard::shards]:
        hi=min(lo+512,N);ng=neighbors[lo:hi];safe=np.maximum(ng,0)
        localvals=np.array(p[:,safe,:]);localvals[:,ng<0,:]=np.nan
        local=np.nanmedian(localvals,axis=2);counts=np.sum(np.isfinite(localvals),axis=2)
        local[counts<5]=np.nan;del localvals
        rows=[];seqs=[];ys=[];meta=[]
        for i in range(lo,hi):
            at=np.array(o[:,i]);st=state[i];coords=np.nan_to_num(geo[i])
            for c in range(C):
                price=np.array(p[:,i,c]);source=np.array(s[:,i,c]);events,conflicts=source_events(price,source,at)
                stats['source_events']+=len(events);stats['conflicting_sources']+=conflicts
                query=list(query_pairs(events,source,at,price,i)) if sampling=='query' else list(label_pairs(events,source,at))
                if from_hour is not None:query=[v for v in query if at[v[1]]>=from_hour]
                stats['query_candidates']+=len(query)
                stats['no_target']+=sum(u is None for _,_,u in query)
                if sampling=='events':stats['no_target']+=int(sum(from_hour is None or at[t]>=from_hour for t in events))-len(query)
                pairs=[(k,t,u,False) for k,t,u in query if u is not None]
                if i in panel:
                    for t in np.flatnonzero((at>=TRAIN_END)&(at<HOLDOUT_START)&np.isfinite(price)&np.isfinite(source)&(source<=at+5/60)):
                        hist=[v for v in events if v<=t]
                        if not hist: continue
                        future=[v for v in events if v>t and at[v]-at[t]<=24 and source[v]>source[t]+5/60]
                        pairs.append((len(hist)-1,int(t),future[0] if future else None,True))
                for k,t,u,ranking in pairs:
                    if from_hour is not None and at[t]<from_hour:continue
                    split=2 if ranking else split_for(float(at[t]),float(at[u]))
                    if split<0: stats['purged']+=1;continue
                    raw=float(price[t]);hist=events[:k+1];old=events[:k]
                    prices=price[hist];changes=np.diff(prices);moved=np.flatnonzero(abs(changes)>1e-5)
                    elapsed=float(at[t]-at[hist[0]])
                    lastchange=float(at[t]-at[hist[moved[-1]+1]]) if len(moved) else elapsed
                    absolute_hour=at[t]+(m['base_epoch']/3600)
                    def past(array,h): return float(array[t-h]) if t>=h else np.nan
                    state_series=market[:,st,c];local_series=local[:,i-lo,c]
                    peer=past(state_series,1);lp=past(local_series,1)
                    row=[raw,float(at[t]-source[t]),np.sin(absolute_hour*2*np.pi/24),np.cos(absolute_hour*2*np.pi/24),np.sin(absolute_hour*2*np.pi/168),np.cos(absolute_hour*2*np.pi/168),st,c//2,c%2,*coords,len(hist),elapsed,float(np.mean(prices)-raw),float(np.std(prices)),float(np.mean(abs(changes)>1e-5)) if len(changes) else 0,lastchange,peer-raw,peer-past(state_series,7),peer-past(state_series,25),lp-raw,past(counts[:,i-lo,c],1),lp-past(local_series,7),lp-past(local_series,25),int(t==0 or not np.isfinite(price[t-1]))]
                    for lag in [1,2,3,4,6,8]:
                        q=old[-lag] if len(old)>=lag else None
                        row.extend([float(price[q]-raw),float(at[t]-at[q])] if q is not None else [np.nan,np.nan])
                    for lag in [1,3,6,12,24]: row.extend([past(price,lag)-raw,int(t>=lag and np.isfinite(price[t-lag]))])
                    seq=np.zeros((CONTEXT,4),dtype='float32')
                    for z,h in enumerate(range(t-CONTEXT+1,t+1)):
                        if h>=0 and np.isfinite(price[h]) and np.isfinite(at[h]):
                            seq[z]=[price[h]-raw, min(max(at[h]-source[h],0),720)/24 if np.isfinite(source[h]) else 30,1,(at[h]-at[t])/24]
                    delta=float(price[u]-raw) if u is not None else np.nan
                    rows.append(row);seqs.append(seq);ys.append(delta)
                    # IDs are for evaluation grouping only, never features.
                    meta.append([i,c,t,float(at[t]),float(at[u]) if u is not None else np.nan,split,panel.get(i,-1)])
                    if not ranking:
                        label='train' if split==0 else 'validation';stats[label]+=1;stats[label+'_changes_10c']+=int(abs(delta)>=.09999)
        if rows:
            np.savez_compressed(out/f'part-{lo:06d}.npz',X=np.array(rows,dtype='float32'),sequence=np.array(seqs,dtype='float16'),y=np.array(ys,dtype='float32'),meta=np.array(meta,dtype='float64'))
        if lo%8192==0: print(json.dumps({'stations_done':hi,**stats}),flush=True)
    info={'features':FEATURES,'states':states,'fuels':m['fuels'],'stats':stats,'sampling':sampling,'from_hour':from_hour,'manifest_sha256':m['manifest_sha256'],'geography_coverage':int(len(validgeo)),
     'geography_note':'Current station coordinates used as static geographic metadata; no current prices/names imported. Historical location changes cannot be ruled out.',
     'limits':('Regular query times every 12 hours with fixed station-index phase. ' if sampling=='query' else 'Source-event observations. ')+'Next-newer-report proxy. Chronological development validation only; absent future labels excluded and counted. No station IDs as features. Repeated station overlap is expected.'}
    (out/f'metadata-shard-{shard}.json').write_text(json.dumps(info,indent=2));print(json.dumps(info),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('--shard',type=int,default=0);p.add_argument('--shards',type=int,default=1);p.add_argument('--from-hour',type=float);p.add_argument('--sampling',choices=['query','events'],default='query');args=p.parse_args()
    if args.from_hour is not None:assert TRAIN_END<=args.from_hour<HOLDOUT_START
    build(args.root,args.shard,args.shards,args.from_hour,args.sampling)
