"""Challenge encounter-trained models on a clock, without future arrival triggers.
Usage: PYTHONPATH=<analysis packages> python3 replayRichTiming.py PRIVATE_DIRECTORY
Private per-minute features remain alongside protected input exports.
"""
import collections
import datetime
import json
import math
import sys
from pathlib import Path
from analyzeRichTiming import classifier, clean, META
from buildRichTimingDataset import load_engines
from backtestAnticipation import available
import pandas as pd

START=datetime.datetime(2026,10,9,tzinfo=datetime.timezone.utc).timestamp()
SPECS=[('random_forest',1),('random_forest',3),('logistic',.5)]


def clock_rows(engines):
    rows=[]
    for account,f in engines:
        en=f.engine
        if not en.fixes:continue
        active=set();ei=0
        for t in range(int(max(START,en.times[0])//60)*60,int(en.times[-1])+1,60):
            while ei<len(en.events) and available(en.events[ei])<=t:
                e=en.events[ei];ei+=1;p=e['payload']
                if e['kind'] in ('visit_candidate','visit_observation'):active.add(p['visitId'])
                elif e['kind'] in ('visit_departure','visit_gap'):active.discard(p['visitId'])
            if active:continue
            fix=f.timing.fix(t)
            if fix is None or fix['payload'].get('speed',-1)<2.5:continue
            rows.append(dict(account=account,cutoff=t,**f.snapshot(t)))
        print('clock features account',account,'cumulative rows',len(rows),flush=True)
    return pd.DataFrame(rows)


def score_alerts(rows,engines,threshold):
    by_account={a:f for a,f in engines};counts=collections.Counter();accounts={};lead=[];matched=set();fuel_labels=collections.Counter();daily=collections.Counter();last={}
    for row in sorted(rows,key=lambda r:r['t']):
        a=row['account'];t=row['t'];day=int(t//86400)
        if row['p']<threshold or t-last.get(a,-math.inf)<1800 or daily[a,day]>=2:continue
        last[a]=t;daily[a,day]+=1
        en=by_account[a].engine
        nxt=next((v for v in en.visits if t<v['arrival']<=t+900),None)
        if nxt is None:outcome='no_observed_encounter'
        elif nxt['terminal'] is None:outcome='unresolved_encounter'
        elif nxt['dwell']>=180:
            outcome='long_stop';lead.append((nxt['arrival']-t)/60);matched.add((a,nxt['id']))
        else:outcome='short_stop'
        if nxt is not None:
            fuel_labels[by_account[a].timing.truth.get(nxt['id'],'unanswered')]+=1
        else:fuel_labels['no_observed_encounter']+=1
        counts[outcome]+=1;accounts.setdefault(str(a),collections.Counter())[outcome]+=1
    return dict(alerts=sum(counts.values()),outcomes=dict(counts),per_account={a:dict(c) for a,c in accounts.items()},
        long_stop_lead_minutes=lead,unique_long_stops_matched=len(matched),actual_answered_outcomes=dict(fuel_labels),
        long_stop_fraction=counts['long_stop']/sum(counts.values()) if counts else None)


def main(base):
    _,engines=load_engines(base)
    path=base/'clock-features-private.csv'
    clock=pd.read_csv(path) if path.exists() else clock_rows(engines)
    if not path.exists():clock.to_csv(path,index=False);path.chmod(0o600)
    visits=pd.read_csv(base/'rich-features-private.csv');features=[c for c in visits if c not in META]
    result={'method':'Every UTC minute with a fresh <=120-second accepted location, speed >=2.5 m/s, and no currently known active station encounter. Retrain each UTC day on completed prior encounters. No future arrival trigger; >=0.5 or >=0.8 score, 30-minute cooldown, maximum two alerts per account per UTC day. Match next detected encounter within 15 minutes.',
      'limitation':'Exploratory challenge of models selected after encounter analysis; unmatched alerts are unknown outcomes, not proven negatives. Offline replay assumes instant server upload but respects on-phone receipt times. No real notifications sent.',
      'eligible_clock_minutes':len(clock),'observed_long_stops_in_replay_dates':sum(v['terminal'] is not None and v['dwell']>=180 and START<=v['arrival']<=f.engine.times[-1] for _,f in engines for v in f.engine.visits),'models':{}}
    for name,lead in SPECS:
        df=visits[visits.lead_minutes==lead];predictions=[];folds=[]
        for day in range(9,14):
            start=datetime.datetime(2026,10,day,tzinfo=datetime.timezone.utc).timestamp()
            train=df[df.known_end<start];test=clock[(clock.cutoff>=start)&(clock.cutoff<start+86400)]
            if len(train)<40 or train.target_long.sum()<3 or not len(test):continue
            cols=[c for c in features if train[c].notna().sum()>=20 and train[c].nunique()>1]
            model=classifier(name);model.fit(train[cols],train.target_long)
            probabilities=model.predict_proba(test[cols])[:,1]
            predictions.extend(dict(account=int(r.account),t=float(r.cutoff),p=float(p)) for (_,r),p in zip(test.iterrows(),probabilities))
            folds.append(dict(day=day,training_visits=len(train),clock_minutes=len(test)))
        result['models'][f'{name}_lead_{lead}']={'folds':folds,'thresholds':{str(th):score_alerts(predictions,engines,th) for th in [.5,.8]}}
        print('replayed',name,lead,flush=True)
    (base/'analysis'/'continuous-replay.json').write_text(json.dumps(clean(result),indent=2,allow_nan=False)+'\n')

if __name__=='__main__':main(Path(sys.argv[1]))
