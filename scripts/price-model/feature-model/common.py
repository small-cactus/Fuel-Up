"""Shared loading and transparent price-policy comparisons."""
import sys,json
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'prospective'))
from evaluate import price_metrics,grouped_mae_interval,ranking_metrics


def load(root):
    parts=[np.load(f) for f in sorted(root.glob('part-*.npz'))]
    return {k:np.concatenate([p[k] for p in parts]) for k in ['X','y','meta']}


def policies(pred):
    for minimum in [0,.03,.05,.1,.15]:
        for cap in [.2,.5]:
            yield f'min{minimum:g}_cap{cap:g}',np.where(abs(pred)>=minimum,np.clip(pred,-cap,cap),0)


def summarize(y,p,m):
    v=m[:,5]==1;ey=y[v];ep=p[v];err=abs(ep-ey)-abs(ey);adjusted=abs(ep)>1e-6
    return price_metrics(ey,ep)|{'adjustments':int(adjusted.sum()),'better':int((err < -1e-6).sum()),'worse':int((err>1e-6).sum()),'max_worsening_cents':float(err.max()*100),'adjusted_station_count':int(len(np.unique(m[v,0][adjusted])))}


def record_predictions(out,name,y,p,m):
    np.save(out/(name+'-predictions.npy'),p.astype('float32'))
    return {'unbounded':summarize(y,p,m),'policies':{rule:summarize(y,q,m) for rule,q in policies(p)}}


def normalizer(X,tr):
    median=np.nan_to_num(np.nanmedian(X[tr],axis=0));fill=np.where(np.isfinite(X),X,median)
    mean=fill[tr].mean(0);std=np.maximum(fill[tr].std(0),.01)
    return np.concatenate([np.clip((fill-mean)/std,-20,20),~np.isfinite(X)],axis=1).astype('float32'),dict(median=median,mean=mean,std=std)
