"""Causal cross-product, station-history and peer-diffusion features.

Augments the original national examples without changing their labels or splits.
Every feature at t uses own-station information through t, and peers through t-1.
"""
import argparse
import hashlib
import json
import warnings
from pathlib import Path

import numpy as np
from sklearn.neighbors import BallTree

warnings.filterwarnings('ignore', message='All-NaN slice encountered')
warnings.filterwarnings('ignore', message='Mean of empty slice')
warnings.filterwarnings('ignore', message='Degrees of freedom <= 0 for slice')


def past_windows(x, window):
    padded=np.pad(x,[(window,0)]+[(0,0)]*(x.ndim-1),constant_values=np.nan)
    return np.lib.stride_tricks.sliding_window_view(padded,window,axis=0)[:len(x)]


def station_features(p, s, o):
    """p,s: hour x product; o: availability by hour. No outcome arguments."""
    T, C = p.shape
    valid = np.isfinite(s) & (s <= o[:, None] + 5 / 60)
    p = np.where(valid, p, np.nan)
    names = []
    values = []

    def add(name, value):
        names.append(name)
        values.append(value.astype('float32'))

    add('price_cents_ending', np.mod(np.round(p * 100), 10))
    add('price_quarter_position', np.mod(p, .25))
    for window in (6, 24, 48):
        hist = past_windows(p,window)
        median = np.nanmedian(hist,axis=-1)
        mad = np.nanmedian(abs(hist-median[...,None]),axis=-1)
        qlo = np.nanmin(hist,axis=-1)
        qhi = np.nanmax(hist,axis=-1)
        add(f'own_median_{window}_residual', median-p)
        add(f'own_mad_{window}', mad)
        add(f'own_min_{window}_residual', qlo-p)
        add(f'own_max_{window}_residual', qhi-p)

    # Persistent grade/payment spreads are estimated from past simultaneous quotes.
    # A current cheap regular price is not assumed erroneous just because premium costs more.
    for j in (0, 1, 2, 3, 4, 5, 6, 7):
        if j >= C:
            continue
        other = p[:, j:j+1]
        gap = other-p
        hist=past_windows(gap,24)
        spread=np.nanmedian(hist,axis=-1)
        spread_mad=np.nanmedian(abs(hist-spread[...,None]),axis=-1)
        count=np.isfinite(hist).sum(axis=-1)
        estimate = gap-spread
        estimate[count < 3] = np.nan
        estimate[:, j] = np.nan  # self cannot provide corroboration
        add(f'product_{j}_spread_residual', estimate)
        add(f'product_{j}_spread_mad', spread_mad)
        add(f'product_{j}_spread_count', count)
        add(f'product_{j}_report_newer_hours', s[:, j:j+1]-s)
        add(f'product_{j}_age', np.broadcast_to(o[:, None]-s[:, j:j+1], p.shape))

    last_delta = np.zeros_like(p)
    prev_delta = np.zeros_like(p)
    since_change = np.full_like(p, np.nan)
    change_count = np.zeros_like(p)
    reversal_rate = np.zeros_like(p)
    typical_change = np.zeros_like(p)
    for c in range(C):
        previous = None
        changes = []
        last_at = None
        for t in range(T):
            if np.isfinite(p[t, c]):
                if previous is not None and abs(p[t, c]-previous) > .00001:
                    changes.append(float(p[t, c]-previous))
                    last_at = o[t]
                previous = p[t, c]
            if changes:
                last_delta[t,c] = changes[-1]
                prev_delta[t,c] = changes[-2] if len(changes)>1 else 0
                since_change[t,c] = o[t]-last_at
                change_count[t,c] = len(changes)
                typical_change[t,c] = np.median(np.abs(changes))
                reversal_rate[t,c] = np.mean(np.array(changes[1:])*np.array(changes[:-1]) < 0) if len(changes)>1 else 0
    for name,value in [('last_actual_change',last_delta),('previous_actual_change',prev_delta),
                       ('hours_since_actual_change',since_change),('actual_change_count',change_count),
                       ('historical_reversal_rate',reversal_rate),('typical_actual_change',typical_change)]:
        add(name,value)
    return names, np.stack(values, axis=-1)


def peer_features(own, peers, sources, observed):
    """All arrays use chronological hours; peers have dimensions hour x neighbor x product."""
    T, C = own.shape
    names, values = [], []
    valid = np.isfinite(sources) & (sources <= observed[:, :, None]+5/60)
    peers = np.where(valid, peers, np.nan)
    median = np.nanmedian(peers, axis=1)
    fresh = np.where(observed[:, :, None]-sources <= 24, peers, np.nan)
    fresh_median = np.nanmedian(fresh, axis=1)

    def add(name, value):
        names.append(name)
        values.append(value)

    for window in (6, 24):
        trend = np.full_like(own, np.nan)
        up = np.full_like(own, np.nan)
        down = np.full_like(own, np.nan)
        spread_residual = np.full_like(own, np.nan)
        for t in range(2, T):
            h = max(0, t-1-window)
            delta = peers[t-1]-peers[h]
            trend[t] = np.nanmean(delta, axis=0)
            count = np.isfinite(delta).sum(axis=0)
            up[t] = np.divide((delta > .00999).sum(axis=0), count, out=np.full(C,np.nan), where=count>0)
            down[t] = np.divide((delta < -.00999).sum(axis=0), count, out=np.full(C,np.nan), where=count>0)
            # Historical station premium/discount over its neighbors, excluding current hour.
            hist = median[max(0,t-window):t]-own[max(0,t-window):t]
            offset = np.nanmedian(hist, axis=0)
            spread_residual[t] = median[t-1]-own[t]-offset
        add(f'peer_mean_change_{window}',trend)
        add(f'peer_fraction_up_{window}',up)
        add(f'peer_fraction_down_{window}',down)
        add(f'peer_offset_adjusted_{window}',spread_residual)
    residual = np.full_like(own, np.nan)
    residual[1:] = fresh_median[:-1]-own[1:]
    add('peer_fresh_median_residual',residual)
    return names,np.stack(values,axis=-1).astype('float32')


def build(root, out, shard=0, shards=1):
    a=root/'arrays'
    meta=json.loads((a/'metadata.json').read_text())
    assert meta['start_hour']+meta['shape'][0] <= 121
    p=np.load(a/'prices.npy',mmap_mode='r')
    s=np.load(a/'sources.npy',mmap_mode='r')
    o=np.load(a/'observed.npy',mmap_mode='r')
    N=len(meta['ids'])
    ids={sid:i for i,sid in enumerate(meta['ids'])}
    geo=np.full((N,2),np.nan)
    for row in json.loads((root/'geography.json').read_text()):
        if row['station_id'] in ids:
            geo[ids[row['station_id']]]=[row['latitude'],row['longitude']]
    good=np.flatnonzero(np.isfinite(geo).all(1))
    tree=BallTree(np.radians(geo[good]))
    distance,near=tree.query(np.radians(geo[good]),k=17)
    neighbors={}
    for k,i in enumerate(good):
        selected=good[near[k]]
        neighbors[i]=selected[(selected!=i)&(distance[k]*3958.8<=6)][:16]
    out.mkdir(parents=True,exist_ok=True)
    oldmeta=json.loads((root/'dataset'/'metadata.json').read_text())
    hashes={}
    for part in sorted((root/'dataset').glob('part-*.npz'))[shard::shards]:
        target=out/part.name
        if target.exists():
            continue
        d=np.load(part);m=d['meta']
        extra=None
        for i in np.unique(m[:,0]).astype(int):
            names,own_features=station_features(np.array(p[:,i]),np.array(s[:,i]),np.array(o[:,i]))
            ng=neighbors.get(i,[])
            if len(ng):
                peer_names,pf=peer_features(np.array(p[:,i]),np.array(p[:,ng]),np.array(s[:,ng]),np.array(o[:,ng]))
            else:
                peer_names,pf=peer_features(np.array(p[:,i]),np.full((len(p),1,p.shape[2]),np.nan),np.full((len(p),1,p.shape[2]),np.nan),np.full((len(p),1),np.nan))
            if extra is None:
                extra=np.full((len(m),len(names)+len(peer_names)),np.nan,dtype='float32')
            ix=np.flatnonzero(m[:,0]==i);t=m[ix,2].astype(int);c=m[ix,1].astype(int)
            extra[ix]=np.concatenate([own_features[t,c],pf[t,c]],axis=1)
        np.savez_compressed(target,X=np.concatenate([d['X'],extra],axis=1),y=d['y'],meta=m)
        schema=oldmeta|{'features':oldmeta['features']+names+peer_names,'base_feature_count':len(oldmeta['features']),
                        'station_feature_count':len(names),'peer_feature_count':len(peer_names)}
        (out/'metadata.json').write_text(json.dumps(schema,indent=2))
        print(json.dumps({'part':part.name,'rows':len(m),'features':len(schema['features'])}),flush=True)
    for part in sorted(out.glob('part-*.npz')):
        hashes[part.name]=hashlib.sha256(part.read_bytes()).hexdigest()
    (out/'shard-hashes.json').write_text(json.dumps(hashes,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('root',type=Path)
    parser.add_argument('out',type=Path)
    parser.add_argument('--shard',type=int,default=0)
    parser.add_argument('--shards',type=int,default=1)
    args=parser.parse_args()
    build(args.root,args.out,args.shard,args.shards)
