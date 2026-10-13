"""Offline station-destination experiment; inputs private, outputs anonymous aggregates.
Usage: python3 backtestDestination.py PRIVATE_DIR OUTPUT_JSON
Requires numpy. No collection, pushes or production model changes.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
import collections
import datetime
import hashlib
import json
import math
import sys
from pathlib import Path
import numpy as np
from backtestAnticipation import available
from destinationFeatures import DestinationFeatures, PersonalRouteMemory, FEATURES

# Frozen before evaluating: all visits stay on one side of a UTC calendar boundary.
SPLIT = datetime.datetime(2026,10,11,tzinfo=datetime.timezone.utc).timestamp()
LEADS = [1,3,5,10,15]


def fit(rows, indices=None, balance=True):
    indices = list(range(len(FEATURES))) if indices is None else indices
    x=np.asarray([r['x'] for r in rows])[:,indices]; y=np.asarray([r['y'] for r in rows],dtype=float)
    weights=np.asarray([r['weight'] for r in rows],dtype=float)
    mean=x.mean(axis=0);scale=x.std(axis=0);scale[scale<1e-8]=1
    x=np.column_stack([np.ones(len(x)),(x-mean)/scale])
    # Equal encounter mass first, then class balance from training only.
    if balance:
        for label in [0,1]:
            mask=y==label; weights[mask]/=max(1e-12,weights[mask].sum())
    weights/=weights.sum(); beta=np.zeros(x.shape[1])
    for _ in range(400):
        p=1/(1+np.exp(-np.clip(x@beta,-30,30)))
        gradient=x.T@(weights*(p-y))+.03*np.r_[0,beta[1:]]
        beta-=.2*gradient
    return dict(indices=indices,mean=mean,scale=scale,beta=beta)


def score(model, candidates):
    x=np.asarray([r['x'] for r in candidates])[:,model['indices']]
    x=np.column_stack([np.ones(len(x)),(x-model['mean'])/model['scale']])
    return 1/(1+np.exp(-np.clip(x@model['beta'],-30,30)))


def metrics(groups, model=None, baseline=None, gate=None):
    out=collections.Counter();ranks=[]
    for g in groups:
        positive=g['positive'];out['positive_visits' if positive else 'short_negative_visits']+=1
        cs=g['candidates']
        if not cs:out['abstained_no_inputs']+=1;continue
        out['positive_with_inputs' if positive else 'short_negative_with_inputs']+=1
        target=next((i for i,c in enumerate(cs) if c['station']==g['station']),None)
        if positive and target is not None:out['positive_target_in_candidates']+=1
        if baseline=='nearest': values=[-c['distance'] for c in cs]
        elif baseline=='heading': values=[-math.log1p(c['distance'])+2*c['heading_cos'] for c in cs]
        elif baseline=='habit':values=[c['history']-c['distance']/1e9 for c in cs]
        else:values=score(model,cs)
        order=sorted(range(len(cs)),key=lambda i:values[i],reverse=True);best=cs[order[0]]
        if positive:
            rank=order.index(target)+1 if target is not None else None
            if rank: ranks.append(rank)
            out['top1_correct']+=int(rank==1);out['top3_correct']+=int(rank is not None and rank<=3)
        alert=model is not None and values[order[0]]>=.5
        if alert and gate is not None: alert=score(gate,[best])[0]>=.5
        if alert:
            out['alerts']+=1
            out['correct_destination_alerts']+=int(positive and best['station']==g['station'])
            out['short_negative_alerts']+=int(not positive)
            out['wrong_destination_positive_alerts']+=int(positive and best['station']!=g['station'])
    out=dict(out)
    out['top1_fraction_all_positive']=out.get('top1_correct',0)/max(1,out.get('positive_visits',0))
    out['top1_fraction_positive_with_inputs']=out.get('top1_correct',0)/max(1,out.get('positive_with_inputs',0))
    if model is not None:out['exact_destination_alert_precision']=out.get('correct_destination_alerts',0)/out['alerts'] if out.get('alerts') else None
    return out


def route_metrics(groups):
    c=collections.Counter()
    for g in groups:
        c['positive_visits' if g['positive'] else 'short_negative_visits']+=1
        sid=g['route_prediction']
        if sid is None:continue
        c['alerts']+=1
        if g['positive'] and sid==g['station']:c['correct_destination']+=1
        elif g['positive']:c['wrong_destination_long_stop']+=1
        else:c['short_negative_alerts']+=1
    return {**dict(c),'exact_destination_alert_precision':c['correct_destination']/c['alerts'] if c['alerts'] else None}


def evaluate(base):
    raw=(base/'research.json').read_bytes(); source=json.loads(raw)
    groups=collections.defaultdict(list)
    for r in source:
        e=dict(r['event']);e['payload']=json.loads(e['payload']) if isinstance(e['payload'],str) else e['payload']
        groups[r['participant_id']].append(e)
    coords={str(s['station_id']):(s['latitude'],s['longitude']) for s in json.loads((base/'stations.json').read_text())}
    usage=json.loads((base/'usage.json').read_text()); engines=[]; examples=[];visits=[]
    for account,(_,events) in enumerate(sorted(groups.items(),key=lambda x:-len(x[1])),1):
        ids={e['payload']['installationId'] for e in events if 'installationId' in e['payload']}
        for u in usage:
            if u['installation_id'] not in ids:continue
            t=datetime.datetime.fromisoformat(u['occurred_at'].replace('Z','+00:00')).timestamp()
            events.append(dict(id=u['id'],kind='usage',recordedAt=t,payload=u['payload']))
        engine=DestinationFeatures(events,coords);engine.route_memory=PersonalRouteMemory(engine);engines.append((account,engine));visits.extend((account,v) for v in engine.visits)
        for v in engine.visits:
            if v['terminal'] is None:continue
            split='train' if v['known_end']<SPLIT else 'test' if v['arrival']>=SPLIT else 'boundary_excluded'
            for lead in LEADS:
                t=v['arrival']-lead*60
                # Do not let a test prediction precede the training freeze boundary.
                if split=='test' and t<SPLIT:continue
                candidates,reason=engine.candidates(t)
                prior=[v0 for v0 in engine.visits if v0['known_end']<=t and v0['dwell']>=180]
                examples.append(dict(prior_stops=len(prior),prior_unique=len({v0['station'] for v0 in prior}),repeat_station=v['station'] in {v0['station'] for v0 in prior},route_prediction=engine.route_memory.predict(t,candidates),account=account,visit=v['id'],station=v['station'],positive=v['dwell']>=180,
                    censored_short=v['dwell']<180 and v['terminal']=='visit_gap',lead=lead,split=split,
                    candidates=candidates,reason=reason))
    training=[]
    for g in examples:
        if g['split']!='train' or not g['candidates']:continue
        cs=g['candidates']
        # Missing positive destinations are coverage failures, not all-negative training examples.
        if g['positive'] and not any(c['station']==g['station'] for c in cs):continue
        for c in cs:training.append(dict(x=c['x'],y=int(g['positive'] and c['station']==g['station']),weight=1/len(cs)))
    full=fit(training)
    geometry=fit(training,list(range(8)))
    gate_training=[]
    for g in examples:
        if g['split']!='train' or not g['candidates']:continue
        cs=g['candidates'];best=cs[int(np.argmax(score(full,cs)))]
        gate_training.append(dict(x=best['x'],y=int(g['positive']),weight=1))
    gate=fit(gate_training,balance=False)
    test=[g for g in examples if g['split']=='test']
    report={'method':{'split_utc':'2026-10-11T00:00:00Z','leads_minutes':LEADS,'positive':'Observed dwell >=180 seconds; not fuel truth',
        'negative':'Every shorter detected encounter; other known candidate stations are candidate negatives',
        'candidate_set':'All stations observed in that account catalog/visit history by cutoff, with static coordinates, within 25 km; target never injected',
        'availability':'Phone-recorded/received time respected; server upload delays ignored. Usage uses client occurred_at.',
        'model':'L2 regularized, encounter weighted, class-balanced logistic regression; fixed regularization .03, threshold .5; not calibrated probability',
        'two_stage_gate':'Separate unbalanced logistic regression on best-ranked candidate features, trained only on earlier encounters, threshold .5; ranker training scores are in-sample, so gate calibration is exploratory',
        'analysis_sequence':'Initial ranker/geometry/baselines evaluated first. Gate and personal-route scenarios added after initial results and user steering; all are exploratory on this shared test window, not independent final validation.',
        'limitations':['Current static station coordinates, not historical coordinate snapshots','Encounter landmarks know retrospectively an encounter is approaching; continuous evaluation reported separately','Short observation gaps can conceal longer stops; conservative sensitivity excludes these','No traffic, road network, tank level, purchase truth or future context used']},
        'input_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [base/'research.json',base/'stations.json',base/'usage.json']},
        'research_events':len(source),'accounts':len(groups),'detected_visits':len(visits),'positive_visits':sum(v['dwell']>=180 for _,v in visits),
        'short_negative_visits':sum(v['dwell']<180 for _,v in visits),'censored_short_visits':sum(v['dwell']<180 and v['terminal']=='visit_gap' for _,v in visits),
        'training_candidate_rows':len(training),'training_positive_rows':sum(r['y'] for r in training),
        'split_visits':{s:len({(g['account'],g['visit']) for g in examples if g['split']==s}) for s in ['train','test','boundary_excluded']},
        'test':{},'test_by_account':{},'feature_training_variation':{},'continuous':{},'personalization_scenarios':{}}
    report['split_summary']={}
    for part in ['train','test']:
        unique={(g['account'],g['visit']):g for g in examples if g['split']==part}
        report['split_summary'][part]={'visits':len(unique),'long_stops':sum(g['positive'] for g in unique.values()),'short_stops':sum(not g['positive'] for g in unique.values())}
    for lead in LEADS:
        gs=[g for g in test if g['lead']==lead]
        report['test'][str(lead)]={name:metrics(gs,model=m,baseline=b) for name,m,b in [('full',full,None),('geometry_only',geometry,None),('nearest',None,'nearest'),('heading',None,'heading'),('habit',None,'habit')]}
        report['test'][str(lead)]['two_stage']=metrics(gs,model=full,gate=gate)
        report['test'][str(lead)]['full_excluding_censored_short']=metrics([g for g in gs if not g['censored_short']],model=full)
    for lead in LEADS:
        gs=[g for g in test if g['lead']==lead]
        scenarios={}
        for minimum in [0,1,2,3,5]:
            for dimension,key in [('completed_long_stops','prior_stops'),('distinct_long_stop_stations','prior_unique')]:
                subset=[g for g in gs if g[key]>=minimum]
                scenarios[f'{dimension}_at_least_{minimum}']={'ranker':metrics(subset,model=full),'route_memory':route_metrics(subset)}
        for repeat in [True,False]:
            subset=[g for g in gs if g['repeat_station']==repeat]
            scenarios['repeat_station' if repeat else 'first_time_station']={'ranker':metrics(subset,model=full),'route_memory':route_metrics(subset)}
        report['personalization_scenarios'][str(lead)]=scenarios
    for account,engine in engines:
        gs=[g for g in test if g['account']==account and g['lead']==5]
        if gs:report['test_by_account'][str(account)]=metrics(gs,model=full)
    x=np.asarray([r['x'] for r in training])
    report['feature_training_variation']={k:bool(np.std(x[:,i])>1e-8) for i,k in enumerate(FEATURES)}
    report['standardized_coefficients']={k:round(float(full['beta'][i+1]),5) for i,k in enumerate(FEATURES)}
    # Frozen model on the full held-out clock, not only pre-encounter landmarks.
    for name,model in [('full',full),('geometry_only',geometry),('two_stage',full),('route_memory',full)]+[(f'route_after_{n}_stops',full) for n in [1,2,3,5]]+[(f'route_after_{n}_stations',full) for n in [2,3]]:
        counts=collections.Counter();leads=[];caught=set();byaccount={}
        for account,engine in engines:
            if not engine.events:continue
            start=max(SPLIT,engine.times[0]);end=engine.times[-1];last=-float('inf');daily=collections.Counter();ac=collections.Counter()
            for t in range(math.ceil(start/60)*60,math.floor(end/60)*60+1,60):
                counts['minute_decisions']+=1
                if t-last<1800 or daily[t//86400]>=2:continue
                if name.startswith('route_after_'):
                    minimum=int(name.split('_')[2]);hist=[v for v in engine.visits if v['known_end']<=t and v['dwell']>=180]
                    amount=len({v['station'] for v in hist}) if name.endswith('_stations') else len(hist)
                    if amount<minimum:continue
                cs,reason=engine.candidates(t)
                if not cs:continue
                counts['decisions_with_candidates']+=1
                if name.startswith('route_'):
                    sid=engine.route_memory.predict(t,cs)
                    if sid is None:continue
                    c=next(c for c in cs if c['station']==sid)
                    if c['distance']<=150:continue
                else:
                    ps=score(model,cs);j=int(np.argmax(ps));c=cs[j]
                    if ps[j]<.5 or c['distance']<=150:continue
                if name=='two_stage' and score(gate,[c])[0]<.5:continue
                last=t;daily[t//86400]+=1;counts['alerts']+=1;ac['alerts']+=1
                future=[v for v in engine.visits if t<v['arrival']<=t+900]
                v=future[0] if future else None
                if v and v['dwell']>=180 and v['station']==c['station']:
                    counts['correct_destination']+=1;ac['correct_destination']+=1;caught.add((account,v['id']));leads.append((v['arrival']-t)/60)
                elif v and v['dwell']<180:counts['short_negative']+=1
                elif v:counts['wrong_destination_long_stop']+=1
                elif t+900>end:counts['end_censored']+=1
                else:counts['no_observed_encounter']+=1
            if ac:byaccount[str(account)]=dict(ac)
        report['continuous'][name]={'alerts':0,'correct_destination':0,'short_negative':0,**dict(counts),'distinct_long_stops_caught':len(caught),'correct_lead_minutes':leads,'by_account':byaccount,
            'policy':'Every minute; route memory uses nearest same-person prior approach within 300m/45deg and short-stop negative veto; others use threshold .5, >150m from candidate, 30-minute cooldown, maximum 2 alerts/account/UTC day; next encounter within 15 minutes',
            'unobserved_outcome':'No observed encounter is not proof of no stop; report separately'}
    return report

if __name__=='__main__':
    result=evaluate(Path(sys.argv[1]));Path(sys.argv[2]).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['detected_visits','positive_visits','short_negative_visits','split_visits','continuous']},indent=2))
