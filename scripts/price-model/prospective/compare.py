"""Compare saved candidates on one development set; never touches final holdout."""
import argparse,json,hashlib,platform,importlib.metadata
from pathlib import Path
import numpy as np
from evaluate import price_metrics,ranking_metrics,grouped_mae_interval

def compare(out):
    d=np.load(out/'evaluation-inputs.npz');X,y,meta=d['X'],d['y'],d['meta']
    va=meta[:,5]==1;ranking=meta[:,5]==2
    assert (meta[va,3]>=72).all() and (meta[va,4]<120).all()
    predictions={'raw':np.zeros(len(y),dtype='float32')}
    for p in out.glob('*-predictions.npy'):
        if p.stem in ('selected-predictions','final-selected-predictions','sparse-predictions','bounded-predictions'):continue
        a=np.load(p);assert a.shape==y.shape and np.isfinite(a).all(),p
        predictions[p.stem.removesuffix('-predictions')]=a
    base=['rmse_d8','mae_d8','rmse_d10','mae_d10','huber_d8']
    if all(n in predictions for n in base):predictions['tree_ensemble']=np.mean([predictions[n] for n in base],axis=0)
    plans={n:{n:1.} for n in predictions if n!='quantile80'}
    if 'tree_ensemble' in predictions:
        for n in list(predictions):
            if not n.startswith('temporal_'):continue
            for w in [.25,.5,.75]:
                name=f'trees_{1-w:g}_{n}_{w:g}';predictions[name]=(1-w)*predictions['tree_ensemble']+w*predictions[n];plans[name]={'tree_ensemble':1-w,n:w}
    raw=price_metrics(y[va],predictions['raw'][va]);best_score=raw['mae_cents']+.1*raw['worst5_mean_cents'];best={'raw':1.};selected=predictions['raw'];selection_rows=[]
    for n,plan in plans.items():
        for shrink in ([1.] if n=='raw' else [.1,.25,.5,.75,1.]):
            p=predictions[n]*shrink;m=price_metrics(y[va],p[va]);score=m['mae_cents']+.1*m['worst5_mean_cents']
            selection_rows.append({'name':n,'weight':shrink,**m})
            if m['mae_cents']<=raw['mae_cents']*1.01 and score<best_score:
                best_score=score;selected=p;best={k:v*shrink for k,v in plan.items()}
    predictions['final_selected']=selected;np.save(out/'final-selected-predictions.npy',selected)
    # Slices are diagnostics, not separate hyperparameter searches.
    slices={'all':va,'age_under_6h':va&(X[:,1]<6),'age_6_to_24h':va&(X[:,1]>=6)&(X[:,1]<24),'age_24_to_72h':va&(X[:,1]>=24)&(X[:,1]<72),'age_72h_plus':va&(X[:,1]>=72)}
    for g in range(7):slices[f'fuel_{g}']=va&(X[:,7]==g)
    for st in np.unique(X[va,6]):slices[f'state_{int(st)}']=va&(X[:,6]==st)
    result={'development_only':True,'selection':best,'score_definition':'MAE + 0.1 worst-five-percent MAE; ordinary MAE <= 1.01 raw; selected on development data',
      'candidate_metrics':{n:price_metrics(y[va],p[va]) for n,p in predictions.items()},
      'ranking':{n:ranking_metrics(X[ranking,0],y[ranking],p[ranking],meta[ranking]) for n,p in predictions.items()},
      'validation_population':{'stations':int(len(np.unique(meta[va,0]))),'input_hour_range': [float(meta[va,3].min()),float(meta[va,3].max())],'target_hour_range':[float(meta[va,4].min()),float(meta[va,4].max())],'target_delay_hours_quantiles':np.quantile(meta[va,4]-meta[va,3],[0,.25,.5,.75,1]).tolist()},
      'selected_station_interval':grouped_mae_interval(y[va],selected[va],meta[va,0]),
      'slices':{n:{'raw':price_metrics(y[ix],predictions['raw'][ix]),'selected':price_metrics(y[ix],selected[ix])} for n,ix in slices.items() if ix.any()},
      'selection_trials':selection_rows,'versions':{'python':platform.python_version(),**{n:importlib.metadata.version(n) for n in ['numpy','catboost','torch','scikit-learn']}},
      'artifact_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir() if p.suffix in ('.cbm','.pt','.npz','.npy')},
      'limitations':['Next independently newer provider report, not verified pump truth.','Development selection is optimistic; final two-day holdout is still reserved.','Only several development hours and correlated station/grade/payment examples.','Development targets are right-censored by the export cutoff; a full 24-hour outcome window has not elapsed for these inputs. Shorter observed update delays are overrepresented.','Price-only local panels omit membership eligibility, preferences and travel cost.']}
    (out/'comparison.json').write_text(json.dumps(result,indent=2));print(json.dumps({'selection':best,'raw':raw,'selected':result['candidate_metrics']['final_selected'],'interval':result['selected_station_interval']}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('results',type=Path);a=p.parse_args();compare(a.results)
