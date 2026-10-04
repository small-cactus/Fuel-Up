"""Chronological aggregate lag experiment, separate from the station holdout."""
import argparse,json,hashlib
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
import joblib

def scores(y,p):
    e=np.abs(y-p)*100
    return {'n':len(y),'mae_cents':float(e.mean()),'rmse_cents':float(np.sqrt(np.mean(e**2))),'p95_cents':float(np.quantile(e,.95))}

def block_interval(delta):
    rng=np.random.default_rng(20261004);n=len(delta);results=[]
    for _ in range(2000):
        starts=rng.integers(0,n,size=int(np.ceil(n/8)));ix=np.concatenate([(np.arange(8)+s)%n for s in starts])[:n];results.append(np.mean(delta[ix])*100)
    return np.quantile(results,[.025,.975]).tolist()

def load(root,name):
    d=pd.read_csv(root/(name+'.csv'),parse_dates=['observation_date']).set_index('observation_date')[name]
    return pd.to_numeric(d,errors='coerce').dropna().loc[:'2026-10-03']

def main(root):
    gas=load(root,'GASREGW');oil={n:load(root,n).reindex(pd.date_range('2000-01-01','2026-10-03')).ffill() for n in ['DCOILWTICO','DCOILBRENTEU']}
    y=gas.diff();features=pd.DataFrame(index=gas.index)
    for k in range(1,5):features[f'gas_change_lag_{k}w']=y.shift(k)
    features['previous_gas']=gas.shift(1);features['season_sin']=np.sin(gas.index.dayofyear*2*np.pi/365.25);features['season_cos']=np.cos(gas.index.dayofyear*2*np.pi/365.25)
    base=list(features.columns);correlations={}
    for name,series in oil.items():
        for lag in [0,1,3,7,8,14,21,28,30,35,42,49,56,60]:
            at=gas.index-pd.Timedelta(days=lag);prior=at-pd.Timedelta(days=7)
            delta=pd.Series(series.reindex(at).to_numpy()-series.reindex(prior).to_numpy(),index=gas.index)/42
            valid=(gas.index<'2024-01-01')&delta.notna()&y.notna()
            correlations[f'{name}_lag_{lag}d']={'training_change_correlation':float(np.corrcoef(delta[valid],y[valid])[0,1]),'n':int(valid.sum()),'predictive_feature':lag>=8}
            if lag>=8:features[f'{name}_change_lag_{lag}d']=delta
    valid=features.notna().all(axis=1)&y.notna()&(features.index>='2001-01-01');features=features[valid];y=y[valid]
    tr=features.index<'2024-01-01';dv=(features.index>='2024-01-01')&(features.index<'2025-01-01');test=features.index>='2025-01-01'
    reports={};predictions={};out=root/'results';out.mkdir(exist_ok=True)
    for name,columns in [('gas_history',base),('gas_history_and_oil',list(features.columns))]:
        trials=[];best=None
        for alpha in [.01,.1,1.,10.,100.]:
            model=make_pipeline(StandardScaler(),Ridge(alpha=alpha));model.fit(features.loc[tr,columns],y[tr]);metric=scores(y[dv].to_numpy(),model.predict(features.loc[dv,columns]));trials.append({'alpha':alpha,**metric})
            if best is None or metric['mae_cents']<best[0]:best=(metric['mae_cents'],alpha)
        model=make_pipeline(StandardScaler(),Ridge(alpha=best[1]));model.fit(features.loc[tr|dv,columns],y[tr|dv]);pred=model.predict(features.loc[test,columns]);predictions[name]=pred
        reports[name]={'alpha':best[1],'development_trials':trials,'test':scores(y[test].to_numpy(),pred),'coefficients':dict(zip(columns,model[-1].coef_.tolist()))}
        joblib.dump(model,out/(name+'.joblib'))
    target=y[test].to_numpy();a=np.abs(predictions['gas_history_and_oil']-target);b=np.abs(predictions['gas_history']-target)
    report={'task':'Next weekly U.S. regular-gasoline change. This is not station-level pump-price estimation.','data_as_of':'2026-10-04','train':'2001-2023','development':'2024','test':'2025 through 2026-09-28',
      'rows':{'train':int(tr.sum()),'development':int(dv.sum()),'test':int(test.sum())},'correlations_train_only':correlations,'models':reports,'persistence_test':scores(target,np.zeros(len(target))),
      'oil_vs_gas_history':{'mean_error_delta_cents':float((a-b).mean()*100),'eight_week_block_interval95_cents':block_interval(a-b)},
      'availability':'Gas history is at least one week old at each forecast origin; predictive crude features are at least eight calendar days old. Lag 0/1/3/7 correlations are descriptive only.',
      'limitations':['Current-vintage EIA/FRED observations, not a complete historical release-vintage archive; revisions cannot be excluded.','Eight-day crude embargo is a conservative publication-delay assumption, not a per-observation release-time audit.','Aggregate lag evidence does not establish a 30-day station-specific causal response.','Station dataset covers only days; it cannot identify a month-long lag by itself.'],
      'source_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('*.csv')}}
    (out/'oil-results.json').write_text(json.dumps(report,indent=2));pd.DataFrame({'date':features.index[test],'actual_change':target,**predictions}).to_csv(out/'test-predictions.csv',index=False)
    print(json.dumps({'models':{n:r['test'] for n,r in reports.items()},'persistence':report['persistence_test'],'oil_increment':report['oil_vs_gas_history']}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('oil_directory',type=Path);a=p.parse_args();main(a.oil_directory)
