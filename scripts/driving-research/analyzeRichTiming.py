"""Anonymous correlations and forward-day classification of three-minute stops.
Usage: python3 analyzeRichTiming.py PRIVATE_FEATURE_CSV OUTPUT_DIRECTORY
Requires numpy/pandas/scipy/scikit-learn/matplotlib. Private rows are never exported.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('OMP_NUM_THREADS','1')
import datetime
import json
import math
import warnings
from pathlib import Path
import sys
import numpy as np
import pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score,roc_auc_score,precision_score,recall_score

META=['account','visit_index','arrival','cutoff','known_end','lead_minutes','target_long','dwell_seconds','label','censored_short']
SPLIT=datetime.datetime(2026,10,11,tzinfo=datetime.timezone.utc).timestamp()


def correlation(df,key):
    d=df[[key,'target_long','account']].dropna()
    if len(d)<10 or d[key].nunique()<2 or d.target_long.nunique()<2:return {'n':len(d),'positives':int(d.target_long.sum()),'rho':None,'within_account_rho':None}
    ranks=d[[key,'target_long']].rank();res=ranks-ranks.groupby(d.account).transform('mean')
    w=res.corr().iloc[0,1]
    return {'n':len(d),'positives':int(d.target_long.sum()),'rho':float(d[[key,'target_long']].corr(method='spearman').iloc[0,1]),
            'within_account_rho':float(w) if np.isfinite(w) else None}


def performance(y,p):
    y=np.asarray(y);p=np.asarray(p);a=p>=.5
    return dict(n=len(y),positives=int(y.sum()),prevalence=float(y.mean()),
        average_precision=float(average_precision_score(y,p)),roc_auc=float(roc_auc_score(y,p)) if len(set(y))==2 else None,
        alerts_at_05=int(a.sum()),correct_alerts_at_05=int((a & (y==1)).sum()),short_alerts_at_05=int((a & (y==0)).sum()),
        precision_at_05=float(precision_score(y,a,zero_division=0)) if a.any() else None,
        recall_at_05=float(recall_score(y,a,zero_division=0)))


def classifier(name):
    if name=='logistic':return make_pipeline(SimpleImputer(strategy='median',add_indicator=True),StandardScaler(),LogisticRegression(C=.1,max_iter=2000,random_state=42))
    if name=='balanced_logistic':return make_pipeline(SimpleImputer(strategy='median',add_indicator=True),StandardScaler(),LogisticRegression(C=.1,class_weight='balanced',max_iter=2000,random_state=42))
    if name=='random_forest':return make_pipeline(SimpleImputer(strategy='median',add_indicator=True),RandomForestClassifier(n_estimators=200,max_depth=4,min_samples_leaf=5,class_weight='balanced_subsample',random_state=42,n_jobs=1))
    return HistGradientBoostingClassifier(max_iter=100,max_depth=2,min_samples_leaf=10,l2_regularization=10,random_state=42)


def main(source,out):
    out.mkdir(parents=True,exist_ok=True)
    frame=pd.read_csv(source);features=[c for c in frame if c not in META]
    correlations=[];performance_by_lead={};folds=[]
    for lead in sorted(frame.lead_minutes.unique()):
        df=frame[frame.lead_minutes==lead]
        for key in features:
            correlations.append(dict(lead_minutes=lead,feature=key,**{prefix+'_'+k:v for prefix,d in [('all',df),('train',df[df.known_end<SPLIT]),('later',df[df.cutoff>=SPLIT])] for k,v in correlation(d,key).items()}))
        predictions={n:[] for n in ['base_rate','logistic','balanced_logistic','random_forest','gradient_boost']}
        for day in range(9,14):
            start=datetime.datetime(2026,10,day,tzinfo=datetime.timezone.utc).timestamp()
            train=df[df.known_end<start];test=df[(df.cutoff>=start)&(df.arrival<start+86400)]
            if len(train)<40 or train.target_long.sum()<3 or not len(test):continue
            cols=[c for c in features if train[c].notna().sum()>=20 and train[c].nunique()>1]
            folds.append(dict(lead_minutes=lead,test_day=f'2026-10-{day:02}',train_visits=len(train),train_positive=int(train.target_long.sum()),test_visits=len(test),test_positive=int(test.target_long.sum()),train_varying_features=len(cols)))
            for name in predictions:
                if name=='base_rate':p=np.repeat(train.target_long.mean(),len(test))
                else:
                    model=classifier(name);model.fit(train[cols],train.target_long);p=model.predict_proba(test[cols])[:,1]
                predictions[name].extend(dict(account=int(row.account),day=day,prior_long=int(row.prior_long_stops),prior_unique=int(row.prior_unique_stations),y=int(row.target_long),p=float(prob)) for (_,row),prob in zip(test.iterrows(),p))
        performance_by_lead[str(lead)]={}
        for name,rows in predictions.items():
            if not rows:continue
            metrics=performance([r['y'] for r in rows],[r['p'] for r in rows])
            metrics['per_account']={str(a):performance([r['y'] for r in rows if r['account']==a],[r['p'] for r in rows if r['account']==a]) for a in sorted({r['account'] for r in rows})}
            metrics['prior_experience']={}
            for key,condition in [('no_prior_long_stop',lambda r:r['prior_long']==0),('one_or_two_prior',lambda r:1<=r['prior_long']<=2),('three_to_five_prior',lambda r:3<=r['prior_long']<=5),('six_plus_prior',lambda r:r['prior_long']>=6),('two_plus_distinct_stations',lambda r:r['prior_unique']>=2)]:
                subset=[r for r in rows if condition(r)]
                if subset:metrics['prior_experience'][key]=performance([r['y'] for r in subset],[r['p'] for r in subset])
            # Cluster bootstrap by account-day describes uncertainty without treating near-time encounters as independent.
            blocks=sorted({(r['account'],r['day']) for r in rows});rng=np.random.default_rng(42);aps=[]
            for _ in range(300):
                sample=[r for i in rng.integers(len(blocks),size=len(blocks)) for r in rows if (r['account'],r['day'])==blocks[i]]
                y=[r['y'] for r in sample]
                if len(set(y))<2:continue
                aps.append(average_precision_score(y,[r['p'] for r in sample]))
            metrics['average_precision_bootstrap_95pct']=[float(x) for x in np.quantile(aps,[.025,.975])] if aps else None
            performance_by_lead[str(lead)][name]=metrics
        print('completed lead',lead,flush=True)
    table=pd.DataFrame(correlations);table.to_csv(out/'feature-correlations.csv',index=False)
    primary=frame[frame.lead_minutes==5]
    coverage=pd.DataFrame([dict(feature=k,nonmissing=int(primary[k].notna().sum()),unique_values=int(primary[k].nunique()),
        positive_nonmissing=int(primary.loc[primary[k].notna(),'target_long'].sum()),
        training_nonmissing=int(primary.loc[primary.known_end<SPLIT,k].notna().sum()),
        training_unique_values=int(primary.loc[primary.known_end<SPLIT,k].nunique())) for k in features])
    coverage.to_csv(out/'feature-coverage.csv',index=False)
    matrix=primary[features+['target_long']].corr(method='spearman',min_periods=20)
    matrix.to_csv(out/'correlation-matrix-full.csv')
    pair_n=primary[features+['target_long']].notna().astype(int).T@primary[features+['target_long']].notna().astype(int)
    pair_n.to_csv(out/'correlation-matrix-pair-counts.csv')
    top=table[(table.lead_minutes==5)&(table.train_n>=40)&(table.train_positives>=5)].assign(magnitude=lambda x:x.train_rho.abs()).sort_values('magnitude',ascending=False).head(18)
    selected=top.feature.tolist()+['target_long']
    plot_matrix(matrix.loc[selected,selected],out/'correlation-matrix.png')
    top.drop(columns='magnitude').to_csv(out/'top-training-signals.csv',index=False)
    labeled=primary[primary.label.isin(['fueled','not_fueling','not_a_stop'])].copy()
    cross=pd.crosstab(labeled.target_long,labeled.label).to_dict()
    summary={'feature_count':len(features),'visits':len(primary),'long_stops':int(primary.target_long.sum()),
        'features_absent_in_training':coverage[coverage.training_nonmissing==0].feature.tolist(),
        'features_without_training_variation':coverage[coverage.training_unique_values<2].feature.tolist(),
        'method':'Forward UTC-day fits; each test day uses only encounters with terminal outcomes available before that day. No future station identity. 8 lead-time views evaluated separately, not independent visits.',
        'scope':'Predicting >=3-minute detected encounter, conditional on a later encounter occurring; no continuous alert precision or fuel-purchase accuracy claim.',
        'exploration':'All feature/model comparisons are exploratory multiple comparisons; no claim of an untouched final test set or statistical significance.',
        'primary_matrix':'Five minutes before arrival. Pairwise Spearman, minimum 20 observations; selected display features ranked by pre-Oct11 correlation only. Full CSV retains all features and pairwise N.',
        'folds':folds,'performance':performance_by_lead,'answered_label_vs_duration':cross,
        'top_training_signals':top.drop(columns='magnitude').where(pd.notnull(top),None).to_dict(orient='records')}
    (out/'results.json').write_text(json.dumps(clean(summary),indent=2,allow_nan=False)+'\n')


def clean(x):
    if isinstance(x,dict):return {str(k):clean(v) for k,v in x.items()}
    if isinstance(x,list):return [clean(v) for v in x]
    if isinstance(x,np.generic):x=x.item()
    return None if isinstance(x,float) and not math.isfinite(x) else x


def plot_matrix(matrix,path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,ax=plt.subplots(figsize=(13,11));cmap=plt.get_cmap('RdBu_r').copy();cmap.set_bad('#e5e7eb')
    im=ax.imshow(matrix,vmin=-1,vmax=1,cmap=cmap)
    labels=[x.replace('_',' ') for x in matrix.index]
    ax.set_xticks(range(len(labels)),labels,rotation=60,ha='right',fontsize=8)
    ax.set_yticks(range(len(labels)),labels,fontsize=8)
    for i in range(len(labels)):
        for j in range(len(labels)):
            v=matrix.iloc[i,j]
            if pd.notna(v):ax.text(j,i,f'{v:.2f}',ha='center',va='center',fontsize=6,color='white' if abs(v)>.65 else '#111827')
    ax.set_title('Station-stop signals · 5 minutes before arrival\nSpearman correlation; display features selected on earlier training days',fontsize=13,pad=18)
    fig.colorbar(im,ax=ax,fraction=.025,pad=.04,label='Correlation')
    fig.text(.03,.018,'Target: detected stop ≥3 min, not confirmed fuel purchase. N varies by pair (see CSV). Correlation does not establish prediction.',fontsize=8)
    fig.tight_layout(rect=[0,.045,1,1]);fig.savefig(path,dpi=180);fig.savefig(path.with_suffix('.pdf'));plt.close(fig)

if __name__=='__main__':
    warnings.filterwarnings('ignore',message='No positive class found')
    main(Path(sys.argv[1]),Path(sys.argv[2]))
