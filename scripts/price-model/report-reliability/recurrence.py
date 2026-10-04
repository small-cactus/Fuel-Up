"""Causal station-history signal for later observed jump/return episodes.

Evidence becomes usable only after its confirming observation. The current
jump and future returns never contribute to its own history score.
"""
import argparse,json
from pathlib import Path
import numpy as np


def prior_counts(at, station, product, confirmed_at):
    order=np.argsort(at,kind='stable'); events=np.flatnonzero(np.isfinite(confirmed_at))
    events=events[np.argsort(confirmed_at[events],kind='stable')]
    station_history={};product_history={};a=np.zeros(len(at),int);b=a.copy();j=0
    for i in order:
        while j<len(events) and confirmed_at[events[j]]<at[i]:
            k=events[j];sid=int(station[k]);key=(sid,int(product[k]))
            # Same-time cash/credit/fuel reports count as one station episode.
            station_history.setdefault(sid,set()).add(round(float(at[k]),4))
            product_history[key]=product_history.get(key,0)+1
            j+=1
        a[i]=len(station_history.get(int(station[i]),()))
        b[i]=product_history.get((int(station[i]),int(product[i])),0)
    return a,b


def study(root,out):
    meta=json.loads((root/'metadata.json').read_text());assert meta['cutoff']<'2026-10-05T18:19:00.000Z'
    p,s,o=[np.load(root/(f+'.npy'),mmap_mode='r') for f in ['prices','sources','observed']]
    rows=[]
    for t in range(1,len(p)-6):
        now=p[t];prev=p[t-1];at=o[t,:,None];before=o[t-1,:,None]
        valid=(abs(now-prev)>=.09999)&(s[t]>s[t-1]+5/60)&(s[t]<=at+5/60)&(s[t-1]<=before+5/60)&(now>0)&(prev>0)&(at>before)&(at-before<=2)
        ii,cc=np.where(valid)
        if not len(ii):continue
        n=len(ii);returns=np.full(n,-1,int);confirm=np.full(n,np.nan);seen_count=np.zeros(n,int);new_count=seen_count.copy()
        for u in range(t+1,t+7):
            observed=(o[u,ii]>o[t,ii])&(o[u,ii]-o[t,ii]<=6)&(s[u,ii,cc]<=o[u,ii]+5/60)&(p[u,ii,cc]>0)
            newer=observed&(s[u,ii,cc]>s[t,ii,cc]+5/60)
            seen_count+=observed;new_count+=newer
            back=newer&(abs(p[u,ii,cc]-prev[ii,cc])<=.03001)
            k=np.maximum(returns,0)
            confirmed=back&(returns>=0)&~np.isfinite(confirm)&(s[u,ii,cc]>s[k,ii,cc]+5/60)&(o[u,ii]-o[k,ii]>=1)
            confirm[confirmed]=o[u,ii[confirmed]]
            returns[back&(returns<0)]=u
        known=(seen_count>=4)&(new_count>=1)
        # Retain unknown rows as historical evidence if confirmed, but exclude their labels from assessment.
        rows.append(np.column_stack([ii,cc,o[t,ii],now[ii,cc]-prev[ii,cc],returns>=0,confirm,known,o[t,ii]-s[t,ii,cc]]))
    d=np.concatenate(rows);a,b=prior_counts(d[:,2],d[:,0],d[:,1],d[:,5]);later=(d[:,2]>=60)&(d[:,6]==1)
    def summarize(mask):
        n=int(mask.sum());positive=int(d[mask,4].sum())
        return {'rows':n,'stations':len(np.unique(d[mask,0])),'returns':positive,'return_rate':positive/n if n else None,
                'confirmed_returns':int(np.isfinite(d[mask,5]).sum())}
    result={'definition':'Predict an observed >=10c jump returning within 3c of prior price within 6h. Eligible later rows have >=4 future observations and >=1 newer timestamp. This is report-pattern prediction, not wrong-price ground truth.',
        'cutoff':meta['cutoff'],'later':summarize(later),'unknown_later':int(((d[:,2]>=60)&(d[:,6]==0)).sum()),'rules':{}}
    for label,history in [('station',a),('same_product',b)]:
        result['rules'][label]={}
        for count in [0,1,2,3]:
            mask=later&(history==0 if count==0 else history>=count)
            result['rules'][label][str(count)]=summarize(mask)
    out.mkdir(parents=True,exist_ok=True)
    np.savez_compressed(out/'recurrence-events.npz',events=d,station_history=a,product_history=b,later=later)
    (out/'recurrence.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--arrays',type=Path,required=True);a.add_argument('--out',type=Path,required=True);v=a.parse_args();study(v.arrays,v.out)
