"""Replay/score the two explicitly frozen rules. No fitting or policy selection."""
import argparse,json,hashlib
from pathlib import Path
import numpy as np
import torch
from catboost import CatBoostClassifier,CatBoostRegressor
from common import load,summarize,grouped_mae_interval,ranking_metrics
from infer_saved import neural_predict


def main(dataset,context,models,freeze,out,kind,cache,replay):
    torch.set_num_threads(8);torch.set_float32_matmul_precision('high')
    config=json.loads(freeze.read_text());assert config['selection_closed']
    d=load(dataset);ev=d['meta'][:,5]!=0;X=d['X'][ev];m=d['meta'][ev];y=d['y'][ev];out.mkdir(exist_ok=True,parents=True)
    if not replay:assert (m[:,3]>=config['later_query_from_hour']).all() and (m[:,3]<120).all()
    for relative,digest in config['files'].items():
        if kind=='query_time' and not relative.startswith('artifacts/hourly/trees/'):continue
        if kind=='source_event' and not any(relative.startswith('artifacts/'+n+'/') for n in ['spatial-enriched','spatial-large']):continue
        path=models/relative.removeprefix('artifacts/')
        assert hashlib.sha256(path.read_bytes()).hexdigest()==digest,str(path)
    if kind=='source_event':
        assert config['policies'][kind]['selection']=='spatial_ensemble:min0.05_cap0.2'
        predictions=[]
        for name in ['spatial-enriched','spatial-large']:
            pred,prob=neural_predict(models/name,X,m,np.load(context),cache);predictions.append(pred);torch.cuda.empty_cache()
        raw=np.mean(predictions,axis=0);p=np.where(abs(raw)>=.05,np.clip(raw,-.2,.2),0)
    else:
        assert config['policies'][kind]['selection']=='trees/station_rmse8:gate_trees_0.75'
        folder=models/'hourly/trees';details=json.loads((folder/'results.json').read_text());cols=details['models']['station_rmse8']['columns']
        reg=CatBoostRegressor();reg.load_model(str(folder/'station_rmse8.cbm'));raw=reg.predict(X[:,:cols]).astype('float32')
        classifier=CatBoostClassifier();classifier.load_model(str(folder/'stale-proxy.cbm'));prob=classifier.predict_proba(X)[:,1].astype('float32')
        p=np.where(prob>=.75,np.clip(raw,-.2,.2),0)
    if replay:
        old=models/('frozen-selected-predictions.npy' if kind=='source_event' else 'hourly/frozen-selected-predictions.npy')
        assert hashlib.sha256(old.read_bytes()).hexdigest()==config['policies'][kind]['development_predictions_sha256']
        expected=np.load(old);delta=float(np.max(abs(p-expected)));assert delta<1e-6
    else:delta=None
    v=m[:,5]==1;r=m[:,5]==2
    report={'kind':kind,'replay':replay,'prediction_replay_max_delta':delta,'freeze_sha256':hashlib.sha256(freeze.read_bytes()).hexdigest(),'policy':config['policies'][kind]['selection'],'raw':summarize(y,np.zeros(len(y)),m),'frozen':summarize(y,p,m),'station_interval':grouped_mae_interval(y[v],p[v],m[v,0]),'ages':{},'ranking':{}}
    for lo,hi in [(0,1),(1,6),(6,24),(24,168),(168,1e9)]:
        ix=v&(X[:,1]>=lo)&(X[:,1]<hi)
        if ix.any():report['ages'][f'{lo}-{hi}h']={'raw':summarize(y[ix],np.zeros(ix.sum()),m[ix]),'frozen':summarize(y[ix],p[ix],m[ix])}
    if r.any():report['ranking']={name:ranking_metrics(X[r,0],y[r],q[r],m[r]) for name,q in [('raw',np.zeros(len(y))),('frozen',p)]}
    np.save(out/'predictions.npy',p);np.savez_compressed(out/'evaluation.npz',y=y,meta=m,raw=X[:,0],age=X[:,1]);(out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ['ages','ranking']}),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('context',type=Path);p.add_argument('models',type=Path);p.add_argument('freeze',type=Path);p.add_argument('out',type=Path);p.add_argument('--kind',choices=['source_event','query_time'],required=True);p.add_argument('--cache',type=Path,required=True);p.add_argument('--replay',action='store_true');a=p.parse_args();main(a.dataset,a.context,a.models,a.freeze,a.out,a.kind,a.cache,a.replay)
