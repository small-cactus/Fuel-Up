"""Train on ordinary driving as well as encounters; predict 5–20 minutes ahead.
Run with the isolated sklearn environment used by analyzeRichTiming.py.
Raw features/predictions remain in PRIVATE_DIRECTORY; only aggregates are saved.
"""
import collections
import datetime
import hashlib
import json
import math
import sys
from pathlib import Path
from analyzeRichTiming import classifier,clean
from buildRichTimingDataset import load_engines
from tripIntentFeatures import TripIntentFeatures,route_match_score,HORIZON,MIN_LEAD
from backtestAnticipation import available
import numpy as np
import pandas as pd

START=datetime.datetime(2026,10,9,tzinfo=datetime.timezone.utc).timestamp()
META={'account','cutoff','y','known_at','outcome','visit'}


def build_rows(engines,min_lead=MIN_LEAD,horizon=HORIZON,target="first_encounter"):
    rows=[]
    for a,rich in engines:
        f=TripIntentFeatures(rich,min_lead,horizon,target);en=rich.engine
        if not en.fixes:continue
        active=set();ei=0
        for t in range(int(en.times[0]//60)*60,int(en.times[-1])+1,60):
            while ei<len(en.events) and available(en.events[ei])<=t:
                e=en.events[ei];ei+=1
                if e['kind'] in ('visit_candidate','visit_observation'):active.add(e['payload']['visitId'])
                elif e['kind'] in ('visit_departure','visit_gap'):active.discard(e['payload']['visitId'])
            fix=rich.timing.fix(t)
            if active or fix is None or fix['payload'].get('speed',-1)<2.5:continue
            x=f.snapshot(t)
            if x is not None:rows.append(dict(account=a,cutoff=t,**x,**f.outcome(t)))
        print('built account',a,'cumulative minutes',len(rows),flush=True)
    return pd.DataFrame(rows)


def replay(rows,engines,threshold,min_history=0,min_matches=0,min_lead=MIN_LEAD,horizon=HORIZON,target="first_encounter"):
    fs={a:TripIntentFeatures(f,min_lead,horizon,target) for a,f in engines};counts=collections.Counter();labels=collections.Counter();by_account={}
    last={};daily=collections.Counter();leads=[];matched=set();alerts=[]
    for r in sorted(rows,key=lambda r:r['cutoff']):
        a=r['account'];t=r['cutoff'];day=int(t//86400)
        if r['p']<threshold or r['prior_long_stops']<min_history or r.get('matches',0)<min_matches or t-last.get(a,-math.inf)<3600 or daily[a,day]>=2:continue
        last[a]=t;daily[a,day]+=1
        o=fs[a].outcome(t);counts[o['outcome']]+=1
        label=fs[a].rich.timing.truth.get(o['visit'],'unanswered') if o['visit'] else 'no_observed_encounter';labels[label]+=1
        by_account.setdefault(str(a),collections.Counter())[o['outcome']]+=1
        if o['outcome'] in ('useful_long','useful_fuel'):
            v=next(v for v in fs[a].en.visits if v['id']==o['visit']);leads.append((v['arrival']-t)/60);matched.add((a,o['visit']))
        alerts.append(dict(account=a,cutoff=t,outcome=o['outcome'],label=label,p=r['p']))
    return dict(alerts=sum(counts.values()),outcomes=dict(counts),answered_labels=dict(labels),
                per_account={a:dict(c) for a,c in by_account.items()},useful_leads_minutes=leads,
                unique_useful_long_stops=len(matched)),alerts


def answered_route_history(history,engines,cutoff):
    answers={}
    for account,f in engines:
        for known,vid,label in f.timing.labels:
            if known<cutoff:answers[(account,vid)]=label
    result=[]
    for h in history:
        label=answers.get((h['account'],h['visit']))
        if h['outcome']=='useful_long':
            if label is None:continue
            result.append(dict(h,y=int(label=='fueled')))
        else:result.append(h)
    return result


def main(base,out,min_lead=MIN_LEAD,horizon=HORIZON,target="first_encounter"):
    out.mkdir(parents=True,exist_ok=True);_,engines=load_engines(base)
    path=base/f'trip-intent-{target}-{min_lead}-{horizon}-private.csv'
    meta_path=base/f'trip-intent-{target}-{min_lead}-{horizon}-cache-meta.json'
    inputs=[base/n for n in ['research.json','stations.json','usage.json']]
    inputs += [Path(__file__).parent/n for n in ['backtestTripIntent.py','tripIntentFeatures.py','richTimingFeatures.py','destinationFeatures.py',
                'timingFeatures.py','backtestAnticipation.py','buildRichTimingDataset.py']]
    fingerprint={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
    fingerprint['label_configuration']={'minimum_lead_seconds':min_lead,'horizon_seconds':horizon,'target':target}
    cached=path.exists() and meta_path.exists() and json.loads(meta_path.read_text())==fingerprint
    df=pd.read_csv(path) if cached else build_rows(engines,min_lead,horizon,target)
    if not cached:
        df.to_csv(path,index=False);path.chmod(0o600)
        meta_path.write_text(json.dumps(fingerprint,indent=2));meta_path.chmod(0o600)
    features=[c for c in df if c not in META and not c.startswith('_')]
    predictions=collections.defaultdict(list);folds=[]
    for day in range(9,14):
        start=datetime.datetime(2026,10,day,tzinfo=datetime.timezone.utc).timestamp()
        train=df[(df.known_at<start)&df.y.notna()];test=df[(df.cutoff>=start)&(df.cutoff<start+86400)]
        if len(train)<40 or train.y.sum()<3 or test.empty:continue
        cols=[c for c in features if train[c].notna().sum()>=20 and train[c].nunique()>1]
        # Equal total weight per observed driving segment; dense minute samples do not gain unlimited influence.
        group_counts=train.groupby(['account','_trip']).y.transform('count')
        weights=(1/group_counts);weights*=len(weights)/weights.sum()
        folds.append(dict(day=day,train_minutes=len(train),train_positive_minutes=int(train.y.sum()),
                          train_segments=len(train.groupby(['account','_trip'])),test_minutes=len(test),features=len(cols)))
        test_rows=test.to_dict('records');history=train.to_dict('records')
        # Sensitivity variant: long-stop positives need a fueling answer already known by training time.
        answered_history=answered_route_history(history,engines,start)
        for name in ['logistic','random_forest','gradient_boost']:
            model=classifier(name)
            if name=='gradient_boost':model.fit(train[cols],train.y,sample_weight=weights)
            else:model.fit(train[cols],train.y,**{list(model.named_steps)[-1]+'__sample_weight':weights})
            probabilities=model.predict_proba(test[cols])[:,1]
            predictions['trip_context_'+name].extend(dict(r,p=float(p)) for r,p in zip(test_rows,probabilities))
        for r in test_rows:
            score,n=route_match_score(r,history)
            predictions['personal_route_contrast'].append(dict(r,p=score,matches=n))
            due=r.get('confirmed_fuel_due_ratio',math.nan)
            # Readiness gating is declared in advance, never fitted to later outcomes.
            predictions['personal_route_and_cycle'].append(dict(r,p=score if math.isfinite(due) and due>=.75 else 0.,matches=n))
            answered_score,answered_n=route_match_score(r,answered_history)
            predictions['answered_route_and_cycle'].append(dict(r,p=answered_score if math.isfinite(due) and due>=.75 else 0.,matches=answered_n))
            precise_score,precise_n=route_match_score(r,answered_history,minimum_examples=3,require_unanimous=True)
            predictions['precision_first_route_and_cycle'].append(dict(r,p=precise_score if math.isfinite(due) and due>=.75 else 0.,matches=precise_n))
            predictions['cycle_only'].append(dict(r,p=1. if math.isfinite(due) and due>=.85 else 0.))
        print('completed fold',day,flush=True)
    result={'target':target,'target_definition':('First detected encounter; shorter stations are negative' if target=='first_encounter' else 'Next answered fuel purchase; intervening short station detections do not terminate the fueling horizon; unanswered long stops excluded from training'), 'minimum_lead_minutes':min_lead/60,'horizon_minutes':horizon/60,'method':'Causal, speed-free trip context plus same-person route-prefix contrasts. Training includes every eligible driving minute with a resolved next-encounter outcome, plus well-tracked no-encounter windows. Outcome follows the explicit target_definition. Target lead is specified separately in this result. Fit on prior UTC days only; observed-segment weighted training. No raw speed, acceleration, slowing, or instantaneous nearest-station distance supplied to classifiers.',
            'caveats':'Station-duration proxy, sparse observation coverage, tiny account sample, exploratory reused snapshot. Tracked no-encounter windows are observational proxy negatives, not verified non-fueling. GPS gaps can split one real trip into several observed segments. No live notifications.',
            'input_and_feature_hashes':fingerprint,
            'observed_test_confirmed_purchases':sum(v['terminal'] is not None and f.timing.truth.get(v['id'])=='fueled' and v['arrival']>=START for _,f in engines for v in f.engine.visits),
            'observed_test_long_stops':sum(v['terminal'] is not None and v['dwell']>=180 and v['arrival']>=START for _,f in engines for v in f.engine.visits),
            'test_target_visits_with_useful_eligible_minute':int(df[(df.cutoff>=START)&(df.y==1)].groupby(['account','visit']).ngroups),
            'short_encounters_represented_in_training_rows':int(df[df.outcome=='short'].groupby(['account','visit']).ngroups),
            'features':features,'training_outcome_counts':df.outcome.value_counts().to_dict(),
            'eligible_minutes':len(df),'test_minutes':int((df.cutoff>=START).sum()),'folds':folds,'models':{}}
    private=[]
    for name,rows in predictions.items():
        result['models'][name]={}
        for threshold in ([.5] if name=='cycle_only' else [.5,.7,.9]):
            for minimum in [0,3,6]:
                key=f'threshold_{threshold}_prior_long_{minimum}'
                metrics,alerts=replay(rows,engines,threshold,minimum,min_lead=min_lead,horizon=horizon,target=target)
                result['models'][name][key]=metrics
                private.extend(dict(model=name,scenario=key,**a) for a in alerts)
        if 'route' in name:
            for th in [.5,.7,.9]:
                for n in [2,3]:
                    result['models'][name][f'threshold_{th}_minimum_{n}_independent_examples'],_=replay(rows,engines,th,min_matches=n,min_lead=min_lead,horizon=horizon,target=target)
    (out/'results.json').write_text(json.dumps(clean(result),indent=2,allow_nan=False)+'\n')
    private_path=base/f'trip-intent-{target}-{min_lead}-{horizon}-alerts-private.json';private_path.write_text(json.dumps(clean(private),indent=2,allow_nan=False));private_path.chmod(0o600)

if __name__=='__main__':main(Path(sys.argv[1]),Path(sys.argv[2]),int(sys.argv[3])*60 if len(sys.argv)>3 else MIN_LEAD,int(sys.argv[4])*60 if len(sys.argv)>4 else HORIZON,sys.argv[5] if len(sys.argv)>5 else 'first_encounter')
