"""Export only causal event-indexed contexts for the TimesFM research benchmark."""
import argparse,json,hashlib
from pathlib import Path
import numpy as np
from features import source_events

def main(root):
    e=np.load(root/'results/evaluation-inputs.npz');select=e['meta'][:,5]==1;meta=e['meta'][select];X=e['X'][select];y=e['y'][select]
    p=np.load(root/'arrays/prices.npy',mmap_mode='r');s=np.load(root/'arrays/sources.npy',mmap_mode='r');o=np.load(root/'arrays/observed.npy',mmap_mode='r')
    contexts=np.full((len(y),p.shape[0]),np.nan,dtype='float32');cov=np.full((len(y),2,p.shape[0]),np.nan,dtype='float32');lengths=np.zeros(len(y),dtype='int32');cache={}
    for k,row in enumerate(meta):
        i,c,t=map(int,row[:3]);key=(i,c)
        if key not in cache:cache[key]=source_events(p[:,i,c],s[:,i,c],o[:,i])[0]
        ix=[v for v in cache[key] if v<=t];vals=p[ix,i,c];assert len(vals) and abs(vals[-1]-X[k,0])<1e-5
        n=len(ix);contexts[k,-n:]=vals;lengths[k]=n
        at=o[ix,i];cov[k,0,-n:]=np.diff(at,prepend=at[0]);cov[k,1,-n:]=at-s[ix,i,c]
    target=root/'timesfm-contexts.npz';np.savez_compressed(target,contexts=contexts,covariates=cov,lengths=lengths,y=y,raw=X[:,0],meta=meta)
    info={'examples':len(y),'stations':len(np.unique(meta[:,0])),'context_length_quantiles':np.quantile(lengths,[0,.25,.5,.75,1]).tolist(),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
      'task':'One next source-report event, not one clock hour. Irregular intervals disclosed; past-only interval and report-age covariates benchmarked separately. No target time supplied to model.',
      'weights_license':'TimesFM 3 Non-Commercial License v1.0; isolated research benchmark only; never mixed into production or distilled into shipping model.'}
    (root/'timesfm-contexts.json').write_text(json.dumps(info,indent=2));print(json.dumps(info),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);a=p.parse_args();main(a.root)
