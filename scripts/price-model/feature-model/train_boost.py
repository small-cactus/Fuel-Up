"""Engineered-feature regression, stale-report proxy classifier and ablations."""
import argparse,json,time
from pathlib import Path
import numpy as np
from catboost import CatBoostRegressor,CatBoostClassifier,Pool
from sklearn.metrics import average_precision_score,roc_auc_score,brier_score_loss
from common import load,record_predictions,summarize


def main(root,out):
    d=load(root);X,y,m=d['X'],d['y'],d['meta'];tr=m[:,5]==0;ev=~tr;va=m[:,5]==1
    assert (m[tr,4]<72).all() and (m[:,3]<120).all()
    out.mkdir(exist_ok=True,parents=True);np.savez_compressed(out/'evaluation.npz',X=X[ev],y=y[ev],meta=m[ev])
    feature_meta=json.loads((root/'metadata.json').read_text());(out/'features.json').write_text(json.dumps(feature_meta,indent=2))
    base=feature_meta['base_feature_count'];own=feature_meta['station_feature_count']
    settings=[('full_rmse8','RMSE',8,X.shape[1]),('full_mae8','MAE',8,X.shape[1]),
              ('full_huber8','Huber:delta=0.1',8,X.shape[1]),('full_rmse10','RMSE',10,X.shape[1]),
              ('station_rmse8','RMSE',8,base+own),('original_rmse8','RMSE',8,base)]
    report={'raw':summarize(y[ev],np.zeros(ev.sum()),m[ev]),'models':{}}
    for name,loss,depth,cols in settings:
        start=time.monotonic()
        model=CatBoostRegressor(iterations=2000,depth=depth,learning_rate=.04,l2_leaf_reg=10,loss_function=loss,eval_metric='MAE',task_type='GPU',devices='0',random_seed=104,early_stopping_rounds=150,verbose=200,allow_writing_files=False,thread_count=8)
        model.fit(Pool(X[tr,:cols],y[tr]),eval_set=Pool(X[va,:cols],y[va]));model.save_model(str(out/(name+'.cbm')))
        pred=model.predict(X[ev,:cols]).astype('float32')
        result=record_predictions(out,name,y[ev],pred,m[ev])
        result.update(seconds=time.monotonic()-start,trees=model.tree_count_,params=model.get_params(),columns=cols,importance=dict(zip(feature_meta['features'][:cols],model.feature_importances_.tolist())))
        report['models'][name]=result;(out/'results.json').write_text(json.dumps(report,indent=2));print(json.dumps({'name':name,'seconds':result['seconds'],'trees':result['trees'],**result['unbounded']}),flush=True)
    # No target-derived sampling weights: probability should reflect the actual next-report rate.
    change=abs(y)>=.09999;start=time.monotonic()
    classifier=CatBoostClassifier(iterations=2000,depth=8,learning_rate=.04,l2_leaf_reg=10,loss_function='Logloss',eval_metric='Logloss',task_type='GPU',devices='0',random_seed=104,early_stopping_rounds=150,verbose=200,allow_writing_files=False,thread_count=8)
    classifier.fit(Pool(X[tr],change[tr]),eval_set=Pool(X[va],change[va]));classifier.save_model(str(out/'stale-proxy.cbm'))
    prob=classifier.predict_proba(X[ev])[:,1].astype('float32');np.save(out/'stale-probabilities.npy',prob)
    vv=m[ev,5]==1
    report['classifier']={'definition':'Next independently newer report differs by at least 10 cents within 24h; not verified current pump staleness','trees':classifier.tree_count_,'seconds':time.monotonic()-start,'prevalence':float(change[va].mean()),'average_precision':average_precision_score(change[va],prob[vv]),'roc_auc':roc_auc_score(change[va],prob[vv]),'brier':brier_score_loss(change[va],prob[vv]),'params':classifier.get_params()}
    report['gated']={}
    for name,_,_,_ in settings:
        pred=np.load(out/(name+'-predictions.npy'))
        for threshold in [.1,.25,.5,.75]:
            q=np.where(prob>=threshold,np.clip(pred,-.2,.2),0)
            report['gated'][f'{name}_p{threshold}']=summarize(y[ev],q,m[ev])
    (out/'results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report['classifier']),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('out',type=Path);a=p.parse_args();main(a.dataset,a.out)
