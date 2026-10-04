"""GPU CatBoost candidates and development-only ensemble selection."""
import argparse,json,time,platform,hashlib
from pathlib import Path
import numpy as np
from catboost import CatBoostRegressor,Pool
from evaluate import price_metrics,ranking_metrics,grouped_mae_interval

def load(root):
    data=[np.load(p) for p in sorted(root.glob('part-*.npz'))]
    return {k:np.concatenate([d[k] for d in data]) for k in ['X','sequence','y','meta']}

def main(root,out):
    out.mkdir(exist_ok=True,parents=True);d=load(root);X,y,meta=d['X'],d['y'],d['meta']
    np.savez_compressed(out/'evaluation-inputs.npz',X=X[meta[:,5]!=0],y=y[meta[:,5]!=0],meta=meta[meta[:,5]!=0],sequence=d['sequence'][meta[:,5]!=0])
    tr=meta[:,5]==0;va=meta[:,5]==1;rank=meta[:,5]==2
    assert np.isfinite(y[tr|va]).all() and (meta[tr,4]<72).all() and (meta[va,3]>=72).all() and (meta[:,3]<120).all()
    pool=Pool(X[tr],y[tr]);validation=Pool(X[va],y[va]);models={};predictions={}
    baselines={'raw':np.zeros(len(y),dtype='float32'),'local_median':np.nan_to_num(X[:,20]),'local_movement':np.nan_to_num(X[:,22])*.75}
    for name,p in baselines.items(): predictions[name]=p
    settings=[('rmse_d8','RMSE',8,11),('mae_d8','MAE',8,11),('rmse_d10','RMSE',10,23),('mae_d10','MAE',10,23),('huber_d8','Huber:delta=0.1',8,47),('quantile80','Quantile:alpha=0.8',8,47)]
    for name,loss,depth,seed in settings:
        start=time.monotonic();model=CatBoostRegressor(iterations=2400,depth=depth,learning_rate=.04,l2_leaf_reg=10,loss_function=loss,eval_metric='MAE',task_type='GPU',devices='0',random_seed=seed,early_stopping_rounds=160,verbose=200,allow_writing_files=False,thread_count=8)
        model.fit(pool,eval_set=validation);model.save_model(str(out/(name+'.cbm')))
        p=model.predict(X).astype('float32');predictions[name]=p
        models[name]={'seconds':time.monotonic()-start,'trees':model.tree_count_,'params':model.get_params(),'importance':model.feature_importances_.tolist()}
        np.save(out/(name+'-predictions.npy'),p[~tr]);print(json.dumps({'candidate':name,**price_metrics(y[va],p[va])}),flush=True)
    # Convex ensembles include raw; choose using development data only.
    raw_score=price_metrics(y[va],baselines['raw'][va]);raw_mae=raw_score['mae_cents']
    best=(raw_mae+.1*raw_score['worst5_mean_cents'],'raw',1.,baselines['raw'])
    candidates=[n for n in models if n!='quantile80']
    choices={n:predictions[n] for n in candidates}
    choices['tree_ensemble']=np.mean([predictions[n] for n in candidates],axis=0)
    for name,p in choices.items():
        for alpha in [.1,.25,.5,.75,1.]:
            trial=p*alpha;score=price_metrics(y[va],trial[va])
            # Tail objective with a strict ordinary MAE guard; never select a uniformly raised model.
            value=score['mae_cents']+.1*score['worst5_mean_cents']
            if score['mae_cents']<=raw_mae*1.01 and (best is None or value<best[0]): best=(value,name,alpha,trial)
    if best is None: best=(0,'raw',1.,baselines['raw'])
    predictions['selected']=best[3]
    result={'created_at':time.time(),'platform':platform.platform(),'selection':{'family':best[1],'weight':best[2],'development_only':True},'models':models,'metrics':{n:price_metrics(y[va],p[va]) for n,p in predictions.items()},'ranking':{n:ranking_metrics(X[rank,0],y[rank],p[rank],meta[rank]) for n,p in predictions.items()},'paired_station_interval':grouped_mae_interval(y[va],best[3][va],meta[va,0]),'rows':{'training':int(tr.sum()),'validation':int(va.sum()),'ranking':int(rank.sum())}}
    (out/'tree-results.json').write_text(json.dumps(result,indent=2));np.save(out/'selected-predictions.npy',best[3][~tr]);print(json.dumps(result),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('out',type=Path);a=p.parse_args();main(a.dataset,a.out)
