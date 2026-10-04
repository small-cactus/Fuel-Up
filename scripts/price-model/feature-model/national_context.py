"""Previous-completed-hour summaries over ALL priced inventory, not a station sample."""
import argparse,json,warnings
from pathlib import Path
import numpy as np
warnings.filterwarnings('ignore',message='All-NaN slice encountered')
warnings.filterwarnings('ignore',message='Mean of empty slice')


def build(root,out):
    m=json.loads((root/'arrays/metadata.json').read_text())
    assert m['start_hour']+m['shape'][0]<=121
    p=np.load(root/'arrays/prices.npy',mmap_mode='r')
    s=np.load(root/'arrays/sources.npy',mmap_mode='r')
    o=np.load(root/'arrays/observed.npy',mmap_mode='r')
    states=sorted(set(m['states']));st=np.array(m['states']);T,N,C=p.shape
    lookup={r['station_id']:(r['latitude'],r['longitude']) for r in json.loads((root/'geography.json').read_text())}
    geo=np.array([lookup.get(i,(np.nan,np.nan)) for i in m['ids']])
    # Spatial token: centroid, quantiles, price count, source age, fresh fraction, movements.
    national=np.full((T,C,len(states),12),np.nan,dtype='float32')
    for k,state in enumerate(states):
        ix=np.flatnonzero(st==state)
        pp=np.array(p[:,ix]);ss=np.array(s[:,ix]);oo=np.array(o[:,ix])[:,:,None]
        valid=np.isfinite(pp)&np.isfinite(ss)&(ss<=oo+5/60)
        pp[~valid]=np.nan
        q=np.nanquantile(pp,[.1,.5,.9],axis=1).transpose(1,2,0)
        mean=np.nanmean(pp,axis=1);age=np.nanmedian(np.where(valid,oo-ss,np.nan),axis=1)
        count=valid.sum(1);fresh=np.sum(valid&(oo-ss<24),axis=1)/np.maximum(count,1)
        center=np.nanmedian(geo[ix],axis=0)
        z=national[:,:,k]
        z[:,:,0]=center[0];z[:,:,1]=center[1];z[:,:,2:5]=q;z[:,:,5]=mean
        z[:,:,6]=np.log1p(count);z[:,:,7]=np.minimum(age,720);z[:,:,8]=fresh
        for d,lag in enumerate((1,6,24)):
            z[lag:,:,9+d]=mean[lag:]-mean[:-lag]
        print(state,flush=True)
    # Shift the entire market context one hour; t=0 has no available prior national context.
    shifted=np.full_like(national,np.nan);shifted[1:]=national[:-1]
    out.mkdir(parents=True,exist_ok=True)
    np.save(out/'national-context.npy',shifted)
    (out/'national-context.json').write_text(json.dumps({'states':states,'shape':list(shifted.shape),'features':['latitude','longitude','p10','median','p90','mean','log_price_count','median_age_hours','fraction_under24h','mean_change1h','mean_change6h','mean_change24h'],'price_inventory':N,'available_at':'Previous completed hourly snapshot only','source_manifest_sha256':m['manifest_sha256']},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('out',type=Path);a=p.parse_args();build(a.root,a.out)
