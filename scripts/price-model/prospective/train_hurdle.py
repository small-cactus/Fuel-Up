"""Station-balanced change detector plus conditional price-change regressors."""
import argparse,json,time
from pathlib import Path
import numpy as np
from catboost import CatBoostClassifier,CatBoostRegressor,Pool
from sklearn.metrics import roc_auc_score,average_precision_score,brier_score_loss
from train_trees import load
from evaluate import price_metrics,grouped_mae_interval

def weights(station):
    _,inv,counts=np.unique(station,return_inverse=True,return_counts=True);w=1/counts[inv];return w/w.mean()

def main(root,out):
    d=load(root);X,y,m=d['X'],d['y'],d['meta'];tr=m[:,5]==0;va=m[:,5]==1;ev=~tr;changed=np.abs(y)>=.00999
    assert (m[tr,4]<72).all() and (m[va,3]>=72).all() and (m[:,3]<120).all()
    out.mkdir(exist_ok=True,parents=True);start=time.monotonic()
    settings=dict(iterations=1500,depth=8,learning_rate=.04,l2_leaf_reg=10,task_type='GPU',devices='0',random_seed=73,early_stopping_rounds=120,verbose=200,allow_writing_files=False,thread_count=8)
    classifier=CatBoostClassifier(**settings,loss_function='Logloss',eval_metric='Logloss')
    classifier.fit(Pool(X[tr],changed[tr],weight=weights(m[tr,0])),eval_set=Pool(X[va],changed[va],weight=weights(m[va,0])))
    classifier.save_model(str(out/'change_classifier.cbm'));prob=classifier.predict_proba(X[ev])[:,1];np.save(out/'change-probabilities.npy',prob)
    em=m[ev];ey=y[ev];v=em[:,5]==1;report={'station_balanced_training':True,'change_threshold_dollars':.01,'classifier_trees':classifier.tree_count_,'classifier_validation':{'roc_auc':roc_auc_score(changed[va],prob[v]),'average_precision':average_precision_score(changed[va],prob[v]),'prevalence':float(changed[va].mean()),'brier':brier_score_loss(changed[va],prob[v])},'models':{}}
    for name,loss in [('conditional_rmse','RMSE'),('conditional_mae','MAE')]:
        a=tr&changed;b=va&changed;model=CatBoostRegressor(**settings,loss_function=loss,eval_metric='MAE')
        model.fit(Pool(X[a],y[a],weight=weights(m[a,0])),eval_set=Pool(X[b],y[b],weight=weights(m[b,0])))
        model.save_model(str(out/(name+'.cbm')));delta=model.predict(X[ev]);variants={'expected':prob*delta,**{f'gate_{t:g}':np.where(prob>=t,delta,0) for t in [.25,.5,.75]}}
        for rule,pred in variants.items():
            label=f'hurdle_{name}_{rule}';np.save(out/(label+'-predictions.npy'),pred.astype('float32'))
            report['models'][label]={'regression_trees':model.tree_count_,'metrics':price_metrics(ey[v],pred[v]),'station_interval':grouped_mae_interval(ey[v],pred[v],em[v,0])};print(json.dumps({'candidate':label,**report['models'][label]}),flush=True)
    report['seconds']=time.monotonic()-start;(out/'hurdle-results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('results',type=Path);a=p.parse_args();main(a.dataset,a.results)
