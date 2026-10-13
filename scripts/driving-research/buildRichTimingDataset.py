"""Build a private causal feature table and anonymous cycle summary from exports."""
import collections
import datetime
import hashlib
import json
import statistics
import sys
from pathlib import Path
import pandas as pd
from backtestAnticipation import available
from richTimingFeatures import RichTimingFeatures

LEADS=[.5,1,3,5,10,15,30,60]

def load_engines(base):
    source=json.loads((base/'research.json').read_text());groups=collections.defaultdict(list)
    for row in source:
        e=dict(row['event']);e['payload']=json.loads(e['payload']) if isinstance(e['payload'],str) else e['payload']
        groups[row['participant_id']].append(e)
    stations={str(s['station_id']):(s['latitude'],s['longitude']) for s in json.loads((base/'stations.json').read_text())}
    usage=json.loads((base/'usage.json').read_text());engines=[]
    for account,es in enumerate(sorted(groups.values(),key=len,reverse=True),1):
        ids={e['payload']['installationId'] for e in es if 'installationId' in e['payload']}
        for u in usage:
            if u['installation_id'] in ids:
                t=datetime.datetime.fromisoformat(u['occurred_at'].replace('Z','+00:00')).timestamp()
                es.append(dict(id=u['id'],kind=u['kind'],recordedAt=t,payload=u['payload']))
        engines.append((account,RichTimingFeatures(es,stations)))
    return source,engines


def cycle_report(engines):
    reports=[]
    for account,feature in engines:
        en=feature.engine;vs={v['id']:v for v in en.visits};labels={};known={}
        for e in en.events:
            if e['kind']=='visit_label':
                p=e['payload'];labels[p['visitId']]=p['label'];known[p['visitId']]=available(e)
        fuels=sorted([v for vid,v in vs.items() if labels.get(vid)=='fueled'],key=lambda v:v['arrival'])
        if not fuels:continue
        intervals=[]
        for a,b in zip(fuels,fuels[1:]):
            start=a['arrival'];end=b['arrival'];x=feature.timing.totals(start);y=feature.timing.totals(end)
            fixes=[e['payload']['timestamp'] for e in en.fixes if start<=e['payload']['timestamp']<=end]
            gaps=[b-a for a,b in zip([start]+fixes,fixes+[end])]
            intervals.append(dict(hours=(end-start)/3600,observed_km=y[0]-x[0],observed_driving_hours=y[1]-x[1],
                                  largest_location_gap_hours=max(gaps)/3600))
        forecasts=[]
        for target in fuels:
            # At each preceding fueling answer, use only labels actually known then.
            previous=[v for v in fuels if v['arrival']<target['arrival'] and known[v['id']]<target['arrival']]
            if not previous:continue
            last=previous[-1];decision=max(known[last['id']],last['known_end'])
            if decision>=target['arrival']:continue
            hist=feature.timing.history(decision)
            if len(hist)<3 or hist[-1]['id']!=last['id']:continue
            ints=[(b['arrival']-a['arrival'])/3600 for a,b in zip(hist,hist[1:])]
            for rule,values in [('all_prior_median',ints),('last_three_median',ints[-3:])]:
                predicted=last['arrival']+statistics.median(values)*3600
                if predicted<decision:continue
                forecasts.append(dict(rule=rule,prior_fills=len(hist),error_hours=(predicted-target['arrival'])/3600,
                                      lead_from_decision_hours=(target['arrival']-decision)/3600))
        reports.append(dict(account=account,confirmed_fills=len(fuels),dwell_minutes=[v['dwell']/60 for v in fuels],
            intervals=intervals,forecasts=forecasts,label_counts=dict(collections.Counter(labels.values()))))
    return reports


def main(base):
    source,engines=load_engines(base);rows=[]
    for account,f in engines:
        labels=f.timing.truth
        for visit_index,v in enumerate(f.engine.visits):
            if v['terminal'] is None:continue
            for lead in LEADS:
                t=v['arrival']-lead*60
                rows.append(dict(account=account,visit_index=visit_index,arrival=v['arrival'],cutoff=t,known_end=v['known_end'],
                    lead_minutes=lead,target_long=int(v['dwell']>=180),dwell_seconds=v['dwell'],
                    label=labels.get(v['id'],'unknown'),censored_short=int(v['dwell']<180 and v['terminal']=='visit_gap'),
                    **f.snapshot(t)))
        print('completed anonymous account',account,flush=True)
    frame=pd.DataFrame(rows);frame.to_csv(base/'rich-features-private.csv',index=False)
    (base/'rich-features-private.csv').chmod(0o600)
    keys=collections.Counter()
    def scan(value):
        if isinstance(value,dict):
            for k,v in value.items():keys[k]+=1;scan(v)
        elif isinstance(value,list):
            for v in value:scan(v)
    for row in source:
        value=row['event']['payload'];scan(json.loads(value) if isinstance(value,str) else value)
    tank_keys={k:n for k,n in keys.items() if any(s in k.lower() for s in ['gallon','tank','odometer','mpg','fuel_level','fuellevel'])}
    report={'snapshot_research_events':len(source),'feature_rows':len(frame),'lead_minutes':LEADS,
            'input_hashes':{n:hashlib.sha256((base/n).read_bytes()).hexdigest() for n in ['research.json','stations.json','usage.json']},
            'tank_related_payload_keys':tank_keys,'cycles':cycle_report(engines)}
    (base/'cycle-summary.json').write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main(Path(sys.argv[1]))
