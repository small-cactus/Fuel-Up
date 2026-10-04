"""Development-only sparse correction policy: preserve small predicted residuals at zero."""
import argparse,json
from pathlib import Path
import numpy as np
from evaluate import price_metrics,ranking_metrics,grouped_mae_interval

def main(out):
    d=np.load(out/'evaluation-inputs.npz');X,y,m=d['X'],d['y'],d['meta'];v=m[:,5]==1;r=m[:,5]==2
    raw=price_metrics(y[v],np.zeros(v.sum()));best_score=raw['mae_cents']+.1*raw['worst5_mean_cents'];best=np.zeros(len(y),dtype='float32');rule={'model':'raw','min_absolute_correction':0,'min_report_age_hours':0};trials=[]
    for f in sorted(out.glob('*-predictions.npy')):
        if f.stem.startswith(('selected-','final-selected-','sparse-','bounded-')):continue
        p=np.load(f);assert p.shape==y.shape and np.isfinite(p).all()
        for threshold in [.025,.05,.1,.2,.4]:
            for age in [0,6,24,72]:
                q=np.where((abs(p)>=threshold)&(X[:,1]>=age),p,0);metric=price_metrics(y[v],q[v]);score=metric['mae_cents']+.1*metric['worst5_mean_cents']
                setting={'model':f.stem.removesuffix('-predictions'),'min_absolute_correction':threshold,'min_report_age_hours':age}
                trials.append({**setting,'adjusted_examples':int(np.count_nonzero(q[v])),**metric})
                if metric['mae_cents']<=raw['mae_cents']*1.01 and score<best_score:best_score=score;best=q;rule=setting
    adjusted=v&(best!=0);changed=v&(abs(y)>=.09999)
    result={'development_only':True,'rule':rule,'raw':raw,'selected':price_metrics(y[v],best[v]),'adjusted_examples':int(adjusted.sum()),'adjusted_stations':int(len(np.unique(m[adjusted,0]))),'adjusted_states':int(len(np.unique(X[adjusted,6]))),
      'station_interval':grouped_mae_interval(y[v],best[v],m[v,0]),'state_interval':grouped_mae_interval(y[v],best[v],X[v,6]),
      'changed_station_interval':grouped_mae_interval(y[changed],best[changed],m[changed,0]),
      'ranking':{'raw':ranking_metrics(X[r,0],y[r],np.zeros(r.sum()),m[r]),'selected':ranking_metrics(X[r,0],y[r],best[r],m[r])},'trials':trials,
      'limitations':['Threshold and age gates explored on the same development data; all trials retained.','Intervals do not correct for hyperparameter selection, source dependence or right-censoring.','Larger predicted residual is a magnitude gate, not a calibrated probability of correctness.','Reserved future holdout required before any production promotion.']}
    np.save(out/'sparse-predictions.npy',best);(out/'sparse-results.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='trials'}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('results',type=Path);a=p.parse_args();main(a.results)
