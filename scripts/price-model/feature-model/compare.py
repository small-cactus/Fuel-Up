"""Retain all development policies, feature ablations and harmful-correction evidence."""
import argparse,json
from pathlib import Path
import numpy as np
from sklearn.metrics import average_precision_score,roc_auc_score,brier_score_loss
from common import summarize,policies,grouped_mae_interval,ranking_metrics


def classification(y,p):
    truth=abs(y)>=.09999
    rows={}
    for threshold in [.1,.25,.5,.75]:
        selected=p>=threshold
        tp=int((selected&truth).sum());fp=int((selected&~truth).sum())
        rows[str(threshold)]={'flagged':int(selected.sum()),'true_changes':tp,'false_alarms':fp,'precision':tp/max(1,selected.sum()),'recall':tp/max(1,truth.sum())}
    return {'definition':'Future source report changes >=10c, not verified pump staleness','prevalence':float(truth.mean()),'average_precision':average_precision_score(truth,p),'roc_auc':roc_auc_score(truth,p),'brier':brier_score_loss(truth,p),'thresholds':rows}


def main(root,prior):
    folders=[d for d in root.iterdir() if d.is_dir() and (d/'evaluation.npz').exists()]
    if not folders:raise ValueError('No completed experiments')
    first=np.load(folders[0]/'evaluation.npz');y=first['y'];m=first['meta'];raw=first['raw'] if 'raw' in first else first['X'][:,0]
    v=m[:,5]==1;r=m[:,5]==2
    predictions={'raw':np.zeros(len(y))};trials={};classifiers={}
    for folder in folders:
        d=np.load(folder/'evaluation.npz')
        np.testing.assert_allclose(m,d['meta'],equal_nan=True);np.testing.assert_allclose(y,d['y'],equal_nan=True)
        if (folder/'best-predictions.npy').exists():
            predictions[folder.name]=np.load(folder/'best-predictions.npy')
        else:
            for file in folder.glob('*-predictions.npy'):
                predictions[f'{folder.name}/{file.stem.replace("-predictions","")}']=np.load(file)
        if (folder/'stale-probabilities.npy').exists():
            classifiers[folder.name]=np.load(folder/'stale-probabilities.npy')
    if prior:
        old=np.load(prior/'evaluation-inputs.npz');np.testing.assert_allclose(old['meta'],m,equal_nan=True)
        original=np.load(prior/'temporal_128x4-predictions.npy')
        predictions['first_frozen_candidate']=np.where(abs(original)>=.1,np.clip(original,-.2,.2),0)
    # Fixed equal-weight blends, without fitting coefficients on the evaluation examples.
    neural=[k for k in ['spatial-enriched','spatial-large'] if k in predictions]
    tree='trees/full_rmse8'
    if len(neural)==2:predictions['spatial_ensemble']=np.mean([predictions[k] for k in neural],axis=0)
    if neural and tree in predictions:predictions['tree_spatial_ensemble']=(predictions[neural[0]]+predictions[tree])/2
    for name,p in predictions.items():
        candidates=[('fixed',p)] if name in ['raw','first_frozen_candidate'] else list(policies(p))
        for rule,q in candidates:
            key=f'{name}:{rule}';trials[key]=summarize(y,q,m)
        if name not in ['raw','first_frozen_candidate']:
            for cl,prob in classifiers.items():
                if cl not in ['trees','spatial-enriched']:continue
                for threshold in [.25,.5,.75]:
                    q=np.where(prob>=threshold,np.clip(p,-.2,.2),0)
                    trials[f'{name}:gate_{cl}_{threshold}']=summarize(y,q,m)
    raw_metric=trials['raw:fixed']
    eligible={k:s for k,s in trials.items() if 'cap0.5' not in k
              and s['under10']+s['over10']<=raw_metric['under10']+raw_metric['over10']+1e-12
              and s['changed_mae_cents']<=raw_metric['changed_mae_cents']}
    best=min(eligible,key=lambda k:eligible[k]['mae_cents'])
    family,rule=best.split(':',1);p=predictions[family]
    if rule=='fixed':q=p
    elif rule.startswith('gate_'):
        cl,threshold=rule[5:].rsplit('_',1);q=np.where(classifiers[cl]>=float(threshold),np.clip(p,-.2,.2),0)
    else:q=dict(policies(p))[rule]
    state=np.load(root/'trees/evaluation.npz')['X'][:,6] if (root/'trees/evaluation.npz').exists() else None
    result={'selection':best,'selection_is_exploratory':True,'selection_guards':'20-cent cap; no increase in total >10-cent errors or mean large-change error versus raw on development','trial_count':len(trials),'trials':trials,'classifiers':{k:classification(y[v],prob[v]) for k,prob in classifiers.items()},
            'selected_station_interval':grouped_mae_interval(y[v],q[v],m[v,0]),'ranking':{name:ranking_metrics(raw[r],y[r],pred[r],m[r]) for name,pred in [('raw',predictions['raw']),('selected',q)]}}
    if state is not None:
        result['state_slices']={str(int(st)):{'raw':summarize(y[v&(state==st)],np.zeros(sum(v&(state==st))),m[v&(state==st)]),'selected':summarize(y[v&(state==st)],q[v&(state==st)],m[v&(state==st)])} for st in np.unique(state[v])}
    np.save(root/'selected-predictions.npy',q)
    (root/'comparison.json').write_text(json.dumps(result,indent=2));print(json.dumps({'selection':best,'metrics':trials[best],'trials':len(trials)},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('--prior',type=Path);a=p.parse_args();main(a.root,a.prior)
