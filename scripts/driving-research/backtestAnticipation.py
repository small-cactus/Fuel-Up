"""Private, chronological single-participant exploratory refuel replay.
Usage: python3 ... EVENTS_JSONL STATIC_STATIONS_JSON OUTPUT_AGGREGATES_JSON
Raw inputs must stay outside the repository. Output excludes identities/routes.
"""
import bisect, collections, datetime, hashlib, json, math, statistics, sys
from pathlib import Path

HORIZONS = (2, 5, 15, 30, 60)
POLICIES = ('interval', 'known_fuel_approach', 'catalog_approach', 'prior_route')
NEGATIVE = {'not_fueling', 'not_a_stop'}

def available(e):
    p = e['payload']
    return max(e['recordedAt'], p.get('receivedAt', 0),
               p.get('labeledAt', 0) if e['kind'] == 'visit_label' else 0,
               p.get('timestamp', 0) if e['kind'] in ('location', 'motion') else 0)

def distance(a, b):
    la, lo, lb, lob = map(math.radians, (a[0], a[1], b[0], b[1]))
    v = math.sin((lb-la)/2)**2+math.cos(la)*math.cos(lb)*math.sin((lob-lo)/2)**2
    return 6371000*2*math.asin(math.sqrt(min(1, max(0, v))))

def bearing(a, b):
    la, lo, lb, lob = map(math.radians, (a[0], a[1], b[0], b[1]))
    return math.degrees(math.atan2(math.sin(lob-lo)*math.cos(lb),
        math.cos(la)*math.sin(lb)-math.sin(la)*math.cos(lb)*math.cos(lob-lo))) % 360

def valid_fix(e):
    p=e['payload']; t=p.get('timestamp', 0); receipt=p.get('receivedAt', e['recordedAt'])
    return (not p.get('simulated', False) and p.get('quality', 'accepted') == 'accepted'
        and 0<=p.get('accuracy', -1)<=40 and -90<=p.get('latitude', 1000)<=90
        and -180<=p.get('longitude', 1000)<=180 and -5<=receipt-t<=30)

def describe(values):
    if not values: return None
    v=sorted(values)
    return {'n':len(v), 'min':round(v[0],2), 'median':round(statistics.median(v),2), 'max':round(v[-1],2)}

class Replay:
    def __init__(self, events, stations):
        self.events=sorted(events, key=lambda e:(available(e), e['id']))
        self.stations={str(s['station_id']):(s['latitude'],s['longitude']) for s in stations}
        self.visits={}; self.labels=[]; self.known={}; self.learned={}
        self.fixes=[e for e in self.events if e['kind']=='location' and valid_fix(e)]
        self.fix_times=[available(e) for e in self.fixes]
        for e in self.events:
            p=e['payload']; t=available(e); k=e['kind']
            if k=='station_catalog':
                for sid in p.get('stationIds',[]): self.known.setdefault(str(sid), t)
            if k=='geofence' and p.get('region','').startswith('research:station:'):
                self.known.setdefault(p['region'].removeprefix('research:station:'),t)
            if k=='visit_observation':
                vid=p['visitId']; self.visits.setdefault(vid,{'id':vid,'arrival':p['startedAt'],
                    'station':str(p['stationId']),'known_at':t,'end':p['lastInsideAt']})
                # Learn a site's approximate position only from observations already received.
                f=self.fix(t)
                if f and abs(f['payload']['timestamp']-p['startedAt'])<=30:
                    self.learned.setdefault(str(p['stationId']), (t,(f['payload']['latitude'],f['payload']['longitude'])))
            if k=='visit_label': self.labels.append(e)
        for e in self.events:
            p=e['payload']; v=self.visits.get(p.get('visitId'))
            if v and e['kind'] in ('visit_departure','visit_gap','visit_candidate'):
                v['end']=max(v['end'],p.get('departedAt',p.get('lastInsideAt',v['end'])))
        # Latest answers are outcomes only. history() below reconstructs answers as of each cutoff.
        self.truth={}
        for e in self.labels: self.truth[e['payload']['visitId']]=e['payload']['label']
        self.targets=[{**v,'label':self.truth[v['id']]} for v in self.visits.values()
            if self.truth.get(v['id']) in NEGATIVE|{'fueled'}]
        self.targets.sort(key=lambda v:v['arrival'])
        self.templates=[]
        for v in self.visits.values():
            for f in self.fixes:
                p=f['payload']; lead=v['arrival']-p['timestamp']
                if 60<=lead<=1800 and p.get('speed',-1)>=2.5 and 0<=p.get('course',-1)<360:
                    self.templates.append((v['id'],v['station'],f,lead))

    def fix(self,t):
        i=bisect.bisect_right(self.fix_times,t)-1
        if i<0:return None
        f=self.fixes[i]
        return f if 0<=t-f['payload']['timestamp']<=120 else None

    def history(self,t):
        labels={}
        for e in self.labels:
            if available(e)>t:break
            labels[e['payload']['visitId']]=e['payload']['label']
        return sorted((v for vid,v in self.visits.items() if v['known_at']<=t
            and v['arrival']<t and labels.get(vid)=='fueled'),key=lambda v:v['arrival'])

    def predict(self,t):
        hist=self.history(t); counts=collections.Counter(v['station'] for v in hist)
        recent={v['station']:v['arrival'] for v in hist}
        habit=max(counts,key=lambda s:(counts[s],recent[s])) if hist else None
        result={'habit':habit,'interval':None,'known_fuel_approach':None,'catalog_approach':None,
                'prior_route':None,'route_eta_minutes':None,'history_count':len(hist),'fresh_fix':self.fix(t) is not None}
        if len(hist)>=3:
            typical=statistics.median(b['arrival']-a['arrival'] for a,b in zip(hist,hist[1:]))
            # Scheduled renewal window: no future interval, location or label used.
            remaining=hist[-1]['arrival']+typical-t
            if 0<remaining<=900:result['interval']=habit
        f=self.fix(t)
        if not f:return result
        p=f['payload']
        if p.get('speed',-1)<2.5 or not 0<=p.get('course',-1)<360:return result
        point=(p['latitude'],p['longitude'])
        prior_labels={}
        for e in self.labels:
            if available(e)>t:break
            prior_labels[e['payload']['visitId']]=e['payload']['label']
        matches=[]
        for vid,sid,f0,lead in self.templates:
            label=prior_labels.get(vid)
            if label not in NEGATIVE|{'fueled'} or available(f0)>t:continue
            q=f0['payload']; angle=abs((q['course']-p['course']+180)%360-180)
            if angle>45:continue
            d=distance(point,(q['latitude'],q['longitude']))
            if d<=300:matches.append((d,-self.visits[vid]['arrival'],vid,sid,lead,label))
        if matches:
            d,_,vid,sid,lead,label=min(matches)
            if label=='fueled':result['prior_route']=sid;result['route_eta_minutes']=lead/60
        for policy in ('known_fuel_approach','catalog_approach'):
            # Habit geometry is learned from past observed stops; catalog geometry is a documented static approximation.
            coords={s:self.learned[s][1] for s in counts if s in self.learned and self.learned[s][0]<=t} if policy=='known_fuel_approach' else {
                s:self.stations[s] for s,seen in self.known.items() if seen<=t and s in self.stations}
            candidates=[]
            for sid,coord in coords.items():
                d=distance(point,coord); angle=abs((bearing(point,coord)-p['course']+180)%360-180)
                if 200<d<=2000 and angle<=45:candidates.append((d,sid))
            if candidates:result[policy]=min(candidates)[1]
        return result

    def report(self):
        fueled=[v for v in self.targets if v['label']=='fueled']; negatives=[v for v in self.targets if v['label'] in NEGATIVE]
        time0=min(e['recordedAt'] for e in self.events); time1=max(e['recordedAt'] for e in self.events)
        kinds=collections.Counter(e['kind'] for e in self.events)
        answer_delays=[(available(e)-self.visits[e['payload']['visitId']]['arrival'])/60 for e in self.labels if e['payload']['visitId'] in self.visits]
        upload_delays=[(datetime.datetime.fromisoformat(e['serverReceivedAt'].replace('Z','+00:00')).timestamp()-e['recordedAt'])/3600 for e in self.events]
        timeline=[]; last_minute=None
        for f in self.fixes:
            t=available(f); minute=int(t//60)
            if minute==last_minute or f['payload'].get('speed',-1)<2.5:continue
            last_minute=minute; timeline.append((t,self.predict(t)))
        horizons={}
        for m in HORIZONS:
            out={'fuel_opportunities':len(fueled),'negative_opportunities':len(negatives),
                 'fuel_with_fresh_fix':0,'negative_with_fresh_fix':0,'fuel_with_prior_confirmed_history':0,
                 'habit_station_correct':0, 'policies':{p:{'fuel_triggered':0,'fuel_exact_station':0,'negative_triggered':0} for p in POLICIES}}
            for v in self.targets:
                pred=self.predict(v['arrival']-m*60); positive=v['label']=='fueled'
                out['fuel_with_fresh_fix' if positive else 'negative_with_fresh_fix']+=int(pred['fresh_fix'])
                if positive:
                    out['fuel_with_prior_confirmed_history']+=int(pred['history_count']>0)
                    out['habit_station_correct']+=int(pred['habit']==v['station'])
                for p in POLICIES:
                    out['policies'][p]['fuel_triggered' if positive else 'negative_triggered']+=int(pred[p] is not None)
                    if positive:out['policies'][p]['fuel_exact_station']+=int(pred[p]==v['station'])
            horizons[str(m)]=out
        alerts={}
        for policy in POLICIES:
            emitted=[]; last=-math.inf; window=1800 if policy=='prior_route' else 900
            for t,pred in timeline:
                sid=pred[policy]
                if sid is None or t-last<1200:continue
                last=t; emitted.append((t,sid))
            counts=collections.Counter(); leads=[]; caught=set(); exact=set(); distances=[]; entry_leads=[]; eta_errors=[]
            for t,sid in emitted:
                next_visits=sorted((v for v in self.visits.values() if t<v['arrival']<=t+window),key=lambda v:v['arrival'])
                if not next_visits:counts['no_observed_station_encounter']+=1;continue
                v=next_visits[0]; label=self.truth.get(v['id'])
                if label=='fueled':
                    counts['confirmed_fuel_in_window']+=1; caught.add(v['id']);leads.append((v['arrival']-t)/60)
                    if sid==v['station']:
                        counts['confirmed_fuel_exact_station']+=1;exact.add(v['id'])
                        f=self.fix(t)
                        if f and sid in self.stations:
                            q=f['payload'];distances.append(distance((q['latitude'],q['longitude']),self.stations[sid]))
                            entries=[z['payload']['timestamp'] for z in self.fixes if t-1800<=z['payload']['timestamp']<=v['arrival']
                                and distance((z['payload']['latitude'],z['payload']['longitude']),self.stations[sid])<=250]
                            if entries:entry_leads.append((min(entries)-t)/60)
                        eta=self.predict(t)['route_eta_minutes'] if policy=='prior_route' else None
                        if eta is not None:eta_errors.append(abs(eta-(v['arrival']-t)/60))
                elif label in NEGATIVE:counts['explicit_nonfuel_in_window']+=1
                else:counts['unconfirmed_encounter_in_window']+=1
            alerts[policy]={'prediction_window_minutes':window/60,'alerts':len(emitted),'alerts_per_calendar_day':round(len(emitted)/((time1-time0)/86400),2),
                'outcome_counts':dict(counts),'distinct_fuel_stops_caught':len(caught),'distinct_fuel_stops_exact_station':len(exact),
                'lead_minutes_for_confirmed_matches':describe(leads),
                'exact_match_distance_to_static_station_m':describe(distances),
                'minutes_before_first_250m_entry':describe(entry_leads),
                'route_eta_absolute_error_minutes':describe(eta_errors),
                'precision_not_identifiable':'Unmatched and unconfirmed alerts are unknown, not established false positives.'}
        # Outcome-independent feature availability at prediction landmarks and upload lag.
        repeat=[];location_lags=[]; label_match=[]
        for v in fueled:
            h=self.history(v['arrival']-120)
            repeat.append(v['station'] in {a['station'] for a in h})
            before=[f for f in self.fixes if available(f)<v['arrival']]
            location_lags.append((v['arrival']-before[-1]['payload']['timestamp'])/60 if before else None)
        # Describe motion/accuracy coverage without passing late motion into any model.
        drive_seconds=sum(min(120,max(0,available(b)-available(a))) for a,b in zip(self.fixes,self.fixes[1:])
            if a['payload'].get('speed',-1)>=2.5)
        return {'protocol_version':1,'events':len(self.events),'kind_counts':dict(kinds),
            'observation_span_days':round((time1-time0)/86400,2),'valid_locations':len(self.fixes),
            'unique_observed_visits':len(self.visits),'latest_label_counts':dict(collections.Counter(self.truth.values())),
            'label_records_without_observed_visit':sum(e['payload']['visitId'] not in self.visits for e in self.labels),
            'confirmed_fuel_stops':len(fueled),'explicit_negative_visits':len(negatives),
            'unconfirmed_observed_visits':sum(v not in self.truth or self.truth[v] not in NEGATIVE|{'fueled'} for v in self.visits),
            'distinct_confirmed_fuel_stations':len({v['station'] for v in fueled}),
            'fuel_station_frequency_counts':sorted(collections.Counter(v['station'] for v in fueled).values(),reverse=True),
            'later_fuel_stops_at_previously_confirmed_station':sum(repeat),
            'positive_interval_hours':describe([(b['arrival']-a['arrival'])/3600 for a,b in zip(fueled,fueled[1:])]),
            'label_delay_minutes':describe(answer_delays),'upload_delay_hours':describe(upload_delays),
            'events_uploaded_within_2_minutes':sum(d<=2/60 for d in upload_delays),
            'moving_minutes_with_recorded_decisions':len(timeline),'approx_observed_moving_hours':round(drive_seconds/3600,2),
            'known_station_ids_with_static_geometry':len(set(self.known)&set(self.stations)),
            'fuel_prearrival_fix_age_minutes':describe([a for a in location_lags if a is not None]),
            'horizons_minutes':horizons,'continuous_alert_replay':alerts,
            'limitations':['Only a small number of self-reported fuel stops; no independent pump or transaction verification.',
                'Visit onset is a detector observation, not exact physical arrival; pre-onset predictions may already be near the forecourt.',
                'Only consented, uploaded samples are observed; absent/unanswered fuel purchases remain unknown.',
                'Current static catalog coordinates are an approximation; catalog IDs are gated by their historical first recorded availability.',
                'Approach predicts proximity and possible visits, not purchase intent; no learned probability or accuracy claim.',
                'Thresholds are fixed exploratory hypotheses, with no model fitting or unseen confirmation set.',
                'On-device availability is replayed; delayed server uploads cannot support the same live server predictions.',
                'Motion, steps, system visits and lifecycle exist but are not used as purchase labels; post-arrival signals are excluded.']}

def main():
    source,station_path,out=map(Path,sys.argv[1:])
    events=[json.loads(line) for line in source.read_text().splitlines() if line]
    if len({e['id'] for e in events})!=len(events):raise ValueError('Duplicate events')
    report=Replay(events,json.loads(station_path.read_text())).report()
    report['input_sha256']=hashlib.sha256(source.read_bytes()).hexdigest()
    out.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
