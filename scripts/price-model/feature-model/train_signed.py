"""Price-transition mixture: down/unchanged/up classifier and conditional magnitudes.

Keeping a quote unchanged is an explicit probability mass, rather than a small
continuous adjustment applied to every otherwise accurate quote.
"""
import argparse,json,time
from pathlib import Path
import numpy as np
from catboost import CatBoostClassifier,CatBoostRegressor,Pool
from common import load,record_predictions
from sklearn.metrics import log_loss,average_precision_score


def signed_predict(folder,X):
    classifier=CatBoostClassifier();classifier.load_model(str(folder/'direction.cbm'))
    probs=classifier.predict_proba(X);delta={}
    for sign in [-1,1]:
        model=CatBoostRegressor();model.load_model(str(folder/f'magnitude{sign}.cbm'))
        delta[sign]=np.maximum(0,model.predict(X))*sign
    ans={}
    for threshold in [.5,.6,.75,.9]:
        p=np.zeros(len(X))
        for j,sign in enumerate(classifier.classes_):
            if sign==0:continue
            selected=probs[:,j]>=threshold;p[selected]=np.clip(delta[int(sign)][selected],-.2,.2)
        ans[f'directional_p{threshold:g}']=p.astype('float32')
    return ans,probs


def main(root,out):
    d=load(root);X,y,m=d['X'],d['y'],d['meta'];tr=m[:,5]==0;va=m[:,5]==1;ev=~tr
    assert (m[tr,4]<72).all() and (m[:,3]<120).all()
    label=np.where(y>.00999,1,np.where(y<-.00999,-1,0))
    out.mkdir(parents=True,exist_ok=True)
    settings=dict(iterations=2000,depth=8,learning_rate=.04,l2_leaf_reg=10,task_type='CPU',random_seed=105,early_stopping_rounds=150,verbose=200,allow_writing_files=False,thread_count=8)
    start=time.monotonic();classifier=CatBoostClassifier(**settings,loss_function='MultiClass',eval_metric='MultiClass')
    classifier.fit(Pool(X[tr],label[tr]),eval_set=Pool(X[va],label[va]));classifier.save_model(str(out/'direction.cbm'))
    report={'definition':'Direction of next report change of at least one cent; zero is an explicit class','classifier_trees':classifier.tree_count_,'params':classifier.get_params(),'magnitudes':{}}
    for sign in [-1,1]:
        a=tr&(label==sign);b=va&(label==sign)
        model=CatBoostRegressor(**settings,loss_function='MAE',eval_metric='MAE')
        model.fit(Pool(X[a],abs(y[a])),eval_set=Pool(X[b],abs(y[b])));model.save_model(str(out/f'magnitude{sign}.cbm'))
        report['magnitudes'][str(sign)]={'train_rows':int(a.sum()),'validation_rows':int(b.sum()),'trees':model.tree_count_,'params':model.get_params()}
    pred,prob=signed_predict(out,X[ev]);np.save(out/'direction-probabilities.npy',prob)
    vv=m[ev,5]==1
    report['validation_log_loss']=log_loss(label[va],prob[vv],labels=classifier.classes_)
    zero=int(np.flatnonzero(classifier.classes_==0)[0]);report['change_average_precision']=average_precision_score(label[va]!=0,1-prob[vv,zero]);report['change_prevalence']=float((label[va]!=0).mean())
    report['models']={name:record_predictions(out,name,y[ev],p,m[ev]) for name,p in pred.items()};report['seconds']=time.monotonic()-start
    np.savez_compressed(out/'evaluation.npz',X=X[ev],y=y[ev],meta=m[ev]);(out/'signed-spec.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('out',type=Path);a=p.parse_args();main(a.dataset,a.out)
