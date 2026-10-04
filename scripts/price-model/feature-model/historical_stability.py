"""Additional historical viewpoints; no station data or final-window access."""
import argparse,json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge
from correlation_study import corr,matrix,save_matrix,block_interval


def main(root,out):
    series={}
    for name in ['DCOILWTICO','DCOILBRENTEU','GASREGW','DGASNYH','DGASUSGULF']:
        f=pd.read_csv(root/(name+'.csv'),index_col=0,parse_dates=True)[name]
        series[name]=pd.to_numeric(f,errors='coerce').dropna().loc['2000-01-01':'2026-10-03']
    # Complete-business-day market observations; no weekend synthetic zero moves.
    market=pd.concat({k:v for k,v in series.items() if k!='GASREGW'},axis=1).dropna()
    changes=market.diff();records=[]
    for era,lo,hi in [('2000-2007',2000,2007),('2008-2014',2008,2014),('2015-2019',2015,2019),('2020-2023',2020,2023),('2024-2026',2024,2026)]:
        view=changes[(changes.index.year>=lo)&(changes.index.year<=hi)]
        for lag in [0,1,2,5,10,20]:
            mat=matrix(view,lag,minimum=50)
            if era in ['2000-2007','2020-2023','2024-2026'] and lag in [0,1,5,20]:save_matrix(mat,out,f'market-{era}-lag{lag}obs',f'Daily market changes {era}: row leads by {lag} common observations')
            for i in mat.index:
                for j in mat.columns:
                    if i!=j:records.append({'era':era,'leader':i,'follower':j,'lag_common_observations':lag,'r':mat.loc[i,j],'n':len(view)-lag})
    pd.DataFrame(records).to_csv(out/'daily-market-leads.csv',index=False)
    gas=series['GASREGW'];y=gas.diff();dates=gas.index
    features=pd.DataFrame({f'gas_lag{k}w':y.shift(k) for k in [1,2,3,4]});features['previous_gas']=gas.shift(1)
    features['season_sin']=np.sin(dates.dayofyear*2*np.pi/365.25);features['season_cos']=np.cos(dates.dayofyear*2*np.pi/365.25);base=list(features)
    for name,s in series.items():
        if name=='GASREGW':continue
        daily=s.reindex(pd.date_range('2000-01-01','2026-10-03')).ffill(limit=7)
        for lag in [8,14,21,28,30,42,60]:
            at=dates-pd.Timedelta(days=lag)
            features[f'{name}_{lag}d']=daily.reindex(at).to_numpy()-daily.reindex(at-pd.Timedelta(days=7)).to_numpy()
    valid=features.notna().all(axis=1)&y.notna()&(dates.year>=2001)
    allpred=[];reports=[]
    for start,end in [(2008,2011),(2012,2015),(2016,2019),(2020,2023),(2024,2026)]:
        tr=valid&(dates.year<start-1);dv=valid&(dates.year==start-1);te=valid&(dates.year>=start)&(dates.year<=end)
        predictions={}
        for name,cols in [('gas_history',base),('oil_30d',base+[k for k in features if k.startswith('DCOIL') and k.endswith('30d')]),('oil_lags',base+[k for k in features if k.startswith('DCOIL')]),('oil_and_wholesale',list(features))]:
            best=(np.inf,None)
            for alpha in [.01,.1,1,10,100,1000]:
                model=make_pipeline(StandardScaler(),Ridge(alpha=alpha));model.fit(features.loc[tr,cols],y[tr]);error=abs(model.predict(features.loc[dv,cols])-y[dv]).mean()
                if error<best[0]:best=(error,alpha)
            model=make_pipeline(StandardScaler(),Ridge(alpha=best[1]));model.fit(features.loc[tr|dv,cols],y[tr|dv]);pred=model.predict(features.loc[te,cols]);predictions[name]=pred
            error=abs(pred-y[te].to_numpy())*100;baseline=abs(predictions['gas_history']-y[te].to_numpy())*100
            reports.append({'era':f'{start}-{end}','model':name,'alpha':best[1],'n':int(te.sum()),'mae_cents':float(error.mean()),'delta_vs_gas_history_cents':float((error-baseline).mean()),'block8_interval95':block_interval(error-baseline)})
        allpred.append(pd.DataFrame({'date':dates[te],'era':f'{start}-{end}','actual':y[te].to_numpy(),**predictions}))
    f=pd.DataFrame(reports);f.to_csv(out/'rolling-historical-scores.csv',index=False);pd.concat(allpred).to_csv(out/'rolling-historical-predictions.csv',index=False)
    # Score matrix uses its own scale: improvements negative, cents/gal.
    import matplotlib.pyplot as plt
    tab=f.pivot(index='era',columns='model',values='delta_vs_gas_history_cents');fig,ax=plt.subplots(figsize=(9,4));im=ax.imshow(tab,cmap='RdBu_r',vmin=-1.5,vmax=1.5,aspect='auto');ax.set_xticks(range(len(tab.columns)),tab.columns,rotation=20,ha='right');ax.set_yticks(range(len(tab)),tab.index)
    for i in range(len(tab)):
        for j in range(len(tab.columns)):ax.text(j,i,f'{tab.iloc[i,j]:+.3f}',ha='center',va='center',fontsize=9)
    ax.set_title('Chronological oil-feature checks: error change vs gas history');fig.colorbar(im,ax=ax,label='MAE difference, cents/gal (negative improves)');fig.tight_layout();fig.savefig(out/'historical-stability.png',dpi=180);plt.close(fig)
    (out/'historical-stability-notes.json').write_text(json.dumps({'selection':'For each era, choose ridge strength on the preceding year and fit using earlier observations only. Fixed feature families from exploratory analysis.','limitation':'Retrospective stability checks with current-vintage data; not newly sealed out-of-sample research. Block intervals are individual comparisons, not familywise guarantees.','daily_market_lags':'Counts common observed market dates, not calendar days or hours. Complete-case holidays can create longer gaps. Spot prices are not physical retail pump prices.','results':reports},indent=2));print(f[['era','model','mae_cents','delta_vs_gas_history_cents']].to_string(index=False))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('out',type=Path);a=p.parse_args();main(a.root,a.out)
