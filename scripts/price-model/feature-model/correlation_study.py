"""Exploratory, availability-aware lead/lag matrices. Never reads final holdout.

Price changes use matched station pairs, not differences of changing inventories.
Hourly national discovery is restricted to the original training window. Matrices
are associations; oil spot observations do not have six-hour resolution.
"""
import argparse, hashlib, json, warnings
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import joblib
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer


def corr(x, y, minimum=12):
    ok=np.isfinite(x)&np.isfinite(y)
    if ok.sum()<minimum or np.std(x[ok])<1e-10 or np.std(y[ok])<1e-10:return np.nan
    return float(np.corrcoef(x[ok],y[ok])[0,1])


def matrix(frame, lag, minimum=12):
    a=frame.to_numpy(); before=a[:-lag] if lag else a; after=a[lag:] if lag else a
    return pd.DataFrame([[corr(before[:,i],after[:,j],minimum) for j in range(a.shape[1])] for i in range(a.shape[1])],index=frame.columns,columns=frame.columns)


def save_matrix(frame,out,name,title):
    frame.to_csv(out/(name+'.csv'))
    fig,ax=plt.subplots(figsize=(max(9,len(frame.columns)*.27),max(5,len(frame)*.27)))
    im=ax.imshow(frame.to_numpy(),cmap='RdBu_r',vmin=-1,vmax=1,aspect='auto')
    ax.set_xticks(range(len(frame.columns)),frame.columns,rotation=90,fontsize=7)
    ax.set_yticks(range(len(frame)),frame.index,fontsize=7);ax.set_title(title,fontsize=11)
    fig.colorbar(im,ax=ax,label='Pearson r');fig.tight_layout();fig.savefig(out/(name+'.png'),dpi=160);plt.close(fig)


def block_interval(values, block=8):
    rng=np.random.default_rng(420);n=len(values)
    samples=[]
    for _ in range(1500):
        starts=rng.integers(n,size=int(np.ceil(n/block)));ix=np.concatenate([(np.arange(block)+s)%n for s in starts])[:n]
        samples.append(np.mean(values[ix]))
    return np.quantile(samples,[.025,.975]).tolist()


def national(root,out):
    m=json.loads((root/'arrays/metadata.json').read_text());p=np.load(root/'arrays/prices.npy',mmap_mode='r');s=np.load(root/'arrays/sources.npy',mmap_mode='r');o=np.load(root/'arrays/observed.npy',mmap_mode='r')
    assert m['start_hour']+len(p)<120
    # Discovery only; unseen development outcomes are not searched for best lags.
    T=int(np.flatnonzero(np.arange(len(p))+m['start_hour']<72)[-1])+1
    states=np.array(m['states']);names=sorted(set(states));moves={};refresh={};coverage={};products={};cohorts={}
    for state in names:
        ix=np.flatnonzero(states==state);pp=np.array(p[:T,ix,1]);ss=np.array(s[:T,ix,1]);oo=np.array(o[:T,ix])
        valid=np.isfinite(pp)&np.isfinite(ss)&np.isfinite(oo)&(ss<=oo+5/60)
        pair=valid[1:]&valid[:-1];delta=pp[1:]-pp[:-1];count=pair.sum(1)
        moves[state]=np.where(count>=30,np.sum(np.where(pair,delta,0),1)/np.maximum(count,1),np.nan)
        refresh[state]=np.where(count>=30,np.sum(pair&(ss[1:]>ss[:-1]+1e-5),1)/np.maximum(count,1),np.nan)
        coverage[state]=count
    frame=pd.DataFrame(moves);updates=pd.DataFrame(refresh);pd.DataFrame(coverage).to_csv(out/'state-paired-counts.csv',index=False)
    frame.to_csv(out/'state-hourly-changes.csv',index=False);updates.to_csv(out/'state-report-refreshes.csv',index=False)
    # Leave-state-out national common movement, equally weighted across states.
    residual=frame.copy()
    for state in names:residual[state]=frame[state]-frame.drop(columns=state).mean(axis=1)
    rows=[]
    for lag in [0,1,3,6,12,24]:
        for name,f in [('state',frame),('state-common-adjusted',residual),('report-refresh',updates)]:
            mat=matrix(f,lag)
            save_matrix(mat,out,f'{name}-lag{lag}h',f'{name}: row leads column by {lag} hours (training only)')
            if name=='state-common-adjusted' and lag>0:
                a=f.to_numpy();n=len(a)-lag
                for i,left in enumerate(names):
                    for j,right in enumerate(names):
                        if i==j or not np.isfinite(mat.iloc[i,j]):continue
                        x=a[:-lag,i];y=a[lag:,j];half=n//2
                        rows.append(dict(leader=left,follower=right,lag_hours=lag,r=mat.iloc[i,j],early_r=corr(x[:half],y[:half]),late_r=corr(x[half:],y[half:]),paired_hours=int((np.isfinite(x)&np.isfinite(y)).sum())))
    ranked=pd.DataFrame(rows);ranked['stable_sign']=(ranked.r*ranked.early_r>0)&(ranked.r*ranked.late_r>0)
    # Circular-shift null preserves each series' autocorrelation. Very few shifts
    # are possible: report that resolution instead of claiming strong significance.
    ranked=ranked.sort_values('r',key=abs,ascending=False)
    tested=[]
    for row in ranked.to_dict('records'):
        lag=row['lag_hours'];x=residual[row['leader']].to_numpy()[:-lag];y=residual[row['follower']].to_numpy()[lag:]
        null=np.array([corr(np.roll(x,k),y) for k in range(1,len(x))]);null=null[np.isfinite(null)]
        row['shift_p']=(1+np.sum(abs(null)>=abs(row['r'])))/(1+len(null));tested.append(row)
    ranked=pd.DataFrame(tested);order=np.argsort(ranked.shift_p);pv=ranked.shift_p.to_numpy()[order]
    q=np.minimum.accumulate((pv*len(pv)/np.arange(1,len(pv)+1))[::-1])[::-1];ranked['fdr_q']=np.nan;ranked.iloc[order,ranked.columns.get_loc('fdr_q')]=np.minimum(q,1)
    ranked.to_csv(out/'regional-lead-candidates.csv',index=False)
    # Independent viewpoints: grades/payment; initial low/high-price cohorts;
    # fresh versus aged reports, held fixed at the first usable observation.
    for c in range(p.shape[2]):
        pp=np.array(p[:T,:,c]);ss=np.array(s[:T,:,c]);oo=np.array(o[:T]);v=np.isfinite(pp)&np.isfinite(ss)&(ss<=oo+5/60);pair=v[1:]&v[:-1];d=pp[1:]-pp[:-1]
        name=m['fuels'][c//2]+('_cash' if c%2==0 else '_credit')
        count=pair.sum(1);products[name]=np.where(count>=100,np.sum(np.where(pair,d,0),1)/np.maximum(count,1),np.nan)
        if c==1:
            first=np.argmax(v,axis=0);initial=pp[first,np.arange(pp.shape[1])];age=oo[first,np.arange(pp.shape[1])]-ss[first,np.arange(pp.shape[1])]
            # State-relative groups avoid merely rediscovering state taxes.
            cheap=np.zeros(len(states),bool);expensive=cheap.copy()
            for st in names:
                ix=states==st;lo,hi=np.nanquantile(initial[ix],[.25,.75]);cheap[ix]=initial[ix]<=lo;expensive[ix]=initial[ix]>=hi
            for label,mask in [('cheap_quartile',cheap),('expensive_quartile',expensive),('initial_age_under6h',age<6),('initial_age_over24h',age>24)]:
                valid=pair&mask[None,:];cnt=valid.sum(1);cohorts[label]=np.where(cnt>=100,np.sum(np.where(valid,d,0),1)/np.maximum(cnt,1),np.nan)
    for label,values in [('product',products),('cohort',cohorts)]:
        f=pd.DataFrame(values);f.to_csv(out/(label+'-changes.csv'),index=False)
        for lag in [0,1,6,12,24]:save_matrix(matrix(f,lag),out,f'{label}-lag{lag}h',f'{label}: row leads column by {lag} hours')
    # Frozen design: can other states' past moves beat own past moves? No pair
    # selection on the evaluation interval; 6-hour gap purges lag-window overlap.
    y=frame;own={};allpast=pd.concat({str(k):frame.shift(k) for k in [1,3,6]},axis=1)
    records=[];split=48
    for state in names:
        base=pd.concat([frame[state].shift(k) for k in [1,3,6]],axis=1)
        for model,X in [('own_history',base),('all_states',allpast)]:
            valid=y[state].notna()&(np.arange(len(y))>=6);tr=valid&(np.arange(len(y))<split-6);te=valid&(np.arange(len(y))>=split)
            if tr.sum()<20 or te.sum()<8:continue
            reg=make_pipeline(SimpleImputer(strategy='median',add_indicator=True),StandardScaler(),Ridge(alpha=100));reg.fit(X.loc[tr].to_numpy(),y.loc[tr,state]);pred=reg.predict(X.loc[te].to_numpy());actual=y.loc[te,state].to_numpy()
            records.append({'state':state,'model':model,'train':int(tr.sum()),'test':int(te.sum()),'mae_cents':float(abs(actual-pred).mean()*100),'zero_change_mae_cents':float(abs(actual).mean()*100)})
    pd.DataFrame(records).to_csv(out/'regional-prediction-check.csv',index=False)
    report={'training_snapshot_hours':T,'products':p.shape[2],'states':len(names),'tested_directed_pairs_and_lags':len(ranked),'fdr_below_05':int((ranked.fdr_q<.05).sum()),'stable_sign_pairs':int(ranked.stable_sign.sum()),'top_candidates':ranked.head(15).replace({np.nan:None}).to_dict('records'),'manifest_sha256':m['manifest_sha256'],'limits':['Only about three days and a shared collection schedule.','Circular-shift null is exploratory and assumes stationarity; no causal interpretation.','Training-only screening; forecast check is an internal chronological training-window split, not untouched confirmation.','Matched pairs prevent changing inventory from directly becoming a price change, but matched populations still vary.']}
    (out/'national-summary.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)


def oil(root,out):
    series={}
    for name in ['DCOILWTICO','DCOILBRENTEU','GASREGW','DGASNYH','DGASUSGULF']:
        path=root/(name+'.csv')
        if path.exists():
            d=pd.read_csv(path,index_col=0,parse_dates=True)[name];series[name]=pd.to_numeric(d,errors='coerce').dropna().loc['2000-01-01':'2026-10-03']
    gas=series['GASREGW'];target=gas.diff();dates=gas.index;lags=[0,1,3,7,8,14,21,28,30,42,60]
    eras={'2001-2007':(dates.year>=2001)&(dates.year<=2007),'2008-2014':(dates.year>=2008)&(dates.year<=2014),'2015-2019':(dates.year>=2015)&(dates.year<=2019),'2020-2023':(dates.year>=2020)&(dates.year<=2023),'2024-2026':dates.year>=2024}
    changes={};levels={};records=[]
    for name,s in series.items():
        if name=='GASREGW':continue
        daily=s.reindex(pd.date_range('2000-01-01','2026-10-03')).ffill(limit=7)
        for lag in lags:
            at=dates-pd.Timedelta(days=lag);x=pd.Series(daily.reindex(at).to_numpy()-daily.reindex(at-pd.Timedelta(days=7)).to_numpy(),index=dates)
            key=f'{name}_{lag}d';changes[key]=x;levels[key]=pd.Series(daily.reindex(at).to_numpy(),index=dates)
            for era,mask in eras.items():
                for regime,condition in [('all',np.ones(len(x),bool)),('rising',x>0),('falling',x<0)]:
                    ok=mask&condition&x.notna()&target.notna()
                    records.append({'series':name,'lag_days':lag,'era':era,'regime':regime,'n':int(ok.sum()),'change_r':corr(x[ok].to_numpy(),target[ok].to_numpy()),'level_r':corr(levels[key][ok].to_numpy(),gas[ok].to_numpy())})
    records=pd.DataFrame(records);records.to_csv(out/'oil-lag-all-views.csv',index=False)
    for name in series:
        if name=='GASREGW':continue
        for regime in ['all','rising','falling']:
            f=records[(records.series==name)&(records.regime==regime)].pivot(index='era',columns='lag_days',values='change_r').reindex(eras)
            save_matrix(f,out,f'{name}-{regime}',f'{name}: earlier 7-day change vs retail weekly change ({regime})')
    # Fixed experiments, settings selected on 2024 only. 2025+ is a previously
    # viewed historical benchmark, explicitly not a new untouched final test.
    base=pd.DataFrame({f'gas_lag{k}w':target.shift(k) for k in [1,2,3,4]});base['season_sin']=np.sin(dates.dayofyear*2*np.pi/365.25);base['season_cos']=np.cos(dates.dayofyear*2*np.pi/365.25)
    sets={'gas_history':[], 'oil_30d':[k for k in changes if k.startswith('DCOIL') and k.endswith('_30d')], 'oil_lags':[k for k in changes if k.startswith('DCOIL') and int(k.rsplit('_',1)[1][:-1])>=8], 'oil_and_wholesale_lags':[k for k in changes if int(k.rsplit('_',1)[1][:-1])>=8]}
    full=pd.concat([base,pd.DataFrame(changes)],axis=1);valid=full.notna().all(axis=1)&target.notna()&(dates.year>=2001);tr=valid&(dates.year<2024);dv=valid&(dates.year==2024);te=valid&(dates.year>=2025)
    predictions={};reports={}
    for name,extra in sets.items():
        cols=list(base)+extra;best=None
        for alpha in [.01,.1,1,10,100,1000]:
            model=make_pipeline(StandardScaler(),Ridge(alpha=alpha));model.fit(full.loc[tr,cols],target[tr]);error=abs(model.predict(full.loc[dv,cols])-target[dv]).mean()
            if best is None or error<best[0]:best=(error,alpha)
        model=make_pipeline(StandardScaler(),Ridge(alpha=best[1]));model.fit(full.loc[tr|dv,cols],target[tr|dv]);pred=model.predict(full.loc[te,cols]);predictions[name]=pred;error=abs(pred-target[te].to_numpy())*100
        joblib.dump(model,out/(name+'.joblib'));replay=joblib.load(out/(name+'.joblib')).predict(full.loc[te,cols]);np.testing.assert_array_equal(pred,replay)
        reports[name]={'alpha':best[1],'mae_cents':float(error.mean()),'p95_cents':float(np.quantile(error,.95)),'n':int(te.sum()),'train_rows':int(tr.sum()),'selection_rows':int(dv.sum()),'features':cols,'standardized_coefficients':dict(zip(cols,model[-1].coef_.tolist())),'saved_model_replay_exact':True}
    raw=target[te].to_numpy();base_error=abs(predictions['gas_history']-raw)*100
    for name,pred in predictions.items():
        delta=abs(pred-raw)*100-base_error;reports[name]['mae_delta_vs_gas_history_cents']=float(delta.mean());reports[name]['block8_interval95']=block_interval(delta)
    pd.DataFrame({'date':dates[te],'actual_change':raw,**predictions}).to_csv(out/'oil-predictions.csv',index=False)
    report={'models':reports,'last_price_mae_cents':float(abs(raw).mean()*100),'split':'Train 2001-2023; select ridge strength 2024; historical benchmark 2025-2026 (previously viewed, not fresh confirmation)','six_hour_effect':'Not identifiable from daily crude and weekly retail series. No interpolated intraday pseudo-observations.','lag_interpretation':'30 days means oil seven-day change ending 30 days before retail observation, not an asserted causal delay.','availability':'Predictive external features lagged at least eight days; current-vintage observations, not complete real-time release vintages.','sources':{name:{'url':'https://fred.stlouisfed.org/series/'+name,'sha256':hashlib.sha256((root/(name+'.csv')).read_bytes()).hexdigest(),'last_observation':str(s.index[-1].date())} for name,s in series.items()}}
    (out/'oil-summary.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('out',type=Path);p.add_argument('--mode',choices=['national','oil'],required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore',RuntimeWarning)
        (national if a.mode=='national' else oil)(a.root,a.out)
