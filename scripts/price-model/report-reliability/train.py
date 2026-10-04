"""Chronological, matched-capacity reliability comparisons with frozen thresholds."""
import argparse, hashlib, json, time
from pathlib import Path
import numpy as np
from catboost import CatBoostClassifier
from sklearn.metrics import average_precision_score, roc_auc_score, brier_score_loss, precision_recall_curve


def threshold_for(y,p):
    precision,recall,thresholds=precision_recall_curve(y,p)
    counts=np.searchsorted(np.sort(p),thresholds,side='left')
    good=(precision[:-1]>=.7)&(len(p)-counts>=30)
    if not good.any(): return None
    ix=np.flatnonzero(good)[np.argmax(recall[:-1][good])]
    return float(thresholds[ix])


def flag_stats(y,p,threshold):
    flags=np.zeros(len(y),bool) if threshold is None else p>=threshold
    tp=int((flags & (y==1)).sum());fp=int((flags & (y==0)).sum())
    return {'flags':int(flags.sum()),'true_positives':tp,'false_positives':fp,
            'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/max(int(y.sum()),1)}


def metrics(y,p,threshold):
    return {'rows':len(y),'positive':int(y.sum()),'prevalence':float(y.mean()),
        'average_precision':float(average_precision_score(y,p)),
        'roc_auc':float(roc_auc_score(y,p)) if len(np.unique(y))>1 else None,
        'brier':float(brier_score_loss(y,p)),'selected_threshold':threshold,
        'selected':flag_stats(y,p,threshold),
        'at_probability':{str(t):flag_stats(y,p,t) for t in [.1,.25,.5,.75,.9]}}


def bootstrap(y,p,threshold,station):
    if threshold is None:
        return {'precision': [None,None], 'recall': [0.,0.]}
    _,inv=np.unique(station,return_inverse=True); n=inv.max()+1
    flags=np.zeros(len(y),bool) if threshold is None else p>=threshold
    totals=np.stack([np.bincount(inv,weights=z,minlength=n) for z in [flags*(y==1),flags,y]])
    rng=np.random.default_rng(104);values=[]
    for _ in range(500):
        a,b,c=totals[:,rng.integers(n,size=n)].sum(axis=1)
        values.append([a/b if b else np.nan,a/c if c else np.nan])
    return dict(zip(['precision','recall'],np.nanpercentile(values,[2.5,97.5],axis=0).T.tolist()))


def train(root,out,device):
    out.mkdir(parents=True,exist_ok=True)
    info=json.loads((root/'metadata.json').read_text())
    parts=[np.load(f) for f in sorted(root.glob('part-*.npz'))]
    d={k:np.concatenate([p[k] for p in parts]) for k in ['X','y','meta','split','end','first','second']}
    X=np.nan_to_num(d['X'],nan=-999,posinf=-999,neginf=-999);y=d['y'];sp=d['split'];m=d['meta'];names=info['features']
    assert np.all(d['end'][sp==0]<48) and np.all(d['end'][sp==1]<60) and np.all(m[sp==2,3]>=60)
    assert len(np.unique(m[:,:3],axis=0))==len(m), 'Duplicate query keys'
    tr=sp==0;ca=sp==1;te=sp==2
    report={'data':info,'splits':{k:{'rows':int(mask.sum()),'positives':int(y[mask].sum()),'stations':len(np.unique(m[mask,0]))} for k,mask in [('train',tr),('calibration',ca),('later_development',te)]},'models':{}}
    print(report['splits'],flush=True)
    predictions={}
    specs={'age_only':[names.index('report_age')], 'existing':list(range(info['base_features'])), 'extended':list(range(len(names)))}
    # A separate ablation isolates the contribution of refresh/cadence history.
    specs['refresh_only']=specs['age_only']+list(range(info['base_features'],info['base_features']+18))
    for name,columns in specs.items():
        start=time.monotonic()
        model=CatBoostClassifier(iterations=700 if name!='age_only' else 300,depth=7 if name!='age_only' else 3,
            learning_rate=.05,l2_leaf_reg=10,loss_function='Logloss',eval_metric='Logloss',task_type=device,
            random_seed=104,early_stopping_rounds=80,verbose=100,allow_writing_files=False,thread_count=8)
        model.fit(X[tr][:,columns],y[tr],eval_set=(X[ca][:,columns],y[ca]))
        path=out/(name+'.cbm');model.save_model(str(path))
        p=model.predict_proba(X[:,columns])[:,1].astype('float32');predictions[name]=p
        threshold=threshold_for(y[ca],p[ca])
        replay=CatBoostClassifier();replay.load_model(str(path))
        delta=float(np.max(abs(replay.predict_proba(X[te][:,columns])[:,1]-p[te])))
        item={'seconds':time.monotonic()-start,'trees':model.tree_count_,'params':model.get_params(),
              'columns':[names[i] for i in columns], 'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
              'saved_replay_max_difference':delta,'calibration':metrics(y[ca],p[ca],threshold),
              'later_development':metrics(y[te],p[te],threshold),
              'station_bootstrap_95':bootstrap(y[te],p[te],threshold,m[te,0]),
              'top_features':sorted(zip([names[i] for i in columns],model.feature_importances_.tolist()),key=lambda x:-x[1])[:25]}
        selected=(p[te]>=threshold) if threshold is not None else np.zeros(te.sum(),bool)
        item['flagged_stations']=len(np.unique(m[te,0][selected]))
        item['age_slices']={}
        for lo,hi in [(0,1),(1,6),(6,24),(24,10000)]:
            mask=te&(d['X'][:,1]>=lo)&(d['X'][:,1]<hi)
            if mask.any():item['age_slices'][f'{lo}-{hi}']=metrics(y[mask],p[mask],threshold)
        item['fuel_slices']={}
        for grade in np.unique(d['X'][:,7]):
            mask=te&(d['X'][:,7]==grade)
            item['fuel_slices'][str(grade)]=metrics(y[mask],p[mask],threshold)
        report['models'][name]=item
        print(name,json.dumps(item['later_development']),flush=True)
        (out/'results.json').write_text(json.dumps(report,indent=2,allow_nan=True))
    np.savez_compressed(out/'evaluation.npz',y=y,meta=m,split=sp,X=d['X'],end=d['end'],first=d['first'],second=d['second'],**predictions)
    (out/'freeze.json').write_text(json.dumps({'status':'exploratory later-development comparison; not final holdout',
        'input_hash':info['input_hash'],'models':{k:{'sha256':v['sha256'],'threshold':v['calibration']['selected_threshold'],'columns':v['columns']} for k,v in report['models'].items()}},indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--data',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--device',default='CPU');a=ap.parse_args();train(a.data,a.out,a.device)
