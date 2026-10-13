"""Causal trip context and route prefixes; no braking or speed predictors.
Speed is used only to distinguish driving from stationary observations.
Coordinates are private route-retrieval inputs, never exported in aggregates.
"""
import bisect
import math
from backtestAnticipation import available, distance

MIN_LEAD=300
HORIZON=1200

class TripIntentFeatures:
    def __init__(self,rich,min_lead=MIN_LEAD,horizon=HORIZON,target="first_encounter"):
        self.rich=rich;self.en=rich.engine;self.min_lead=min_lead;self.horizon=horizon;self.target=target
        self.times=self.en.fix_times
        self.prefixes=[];origin=None;last=None;stationary_since=None;trip=-1;km=0
        for e in self.en.fixes:
            p=e['payload'];t=p['timestamp'];moving=p.get('speed',-1)>=2.5
            gap=last is None or t-last['timestamp']>600
            if not moving:
                if stationary_since is None:stationary_since=t
            elif origin is None or gap or (stationary_since is not None and t-stationary_since>=300):
                origin=p;trip+=1;km=0
            if moving:stationary_since=None
            if last is not None and origin is not None and origin['timestamp']<t:
                dt=t-last['timestamp'];meters=distance((p['latitude'],p['longitude']),(last['latitude'],last['longitude']))
                if 0<dt<=120 and meters/dt<=70:km+=meters/1000
            self.prefixes.append((trip,origin,km));last=p

    def snapshot(self,t):
        f=self.rich.timing.fix(t)
        if f is None:return None
        p=f['payload'];i=bisect.bisect_right(self.times,t)-1;trip,origin,km=self.prefixes[i]
        if origin is None:return None
        out={'_trip':trip,'_lat':p['latitude'],'_lon':p['longitude'],'_heading':p.get('course',-1),
             '_origin_lat':origin['latitude'],'_origin_lon':origin['longitude'],
             'segment_elapsed_min':(t-origin['timestamp'])/60,'segment_observed_km':km,
             'origin_displacement_km':distance((p['latitude'],p['longitude']),(origin['latitude'],origin['longitude']))/1000,
             'utc_hour_sin':math.sin(t%86400/86400*math.tau),'utc_hour_cos':math.cos(t%86400/86400*math.tau),
             'utc_weekday_sin':math.sin(((t//86400+3)%7)/7*math.tau),'utc_weekday_cos':math.cos(((t//86400+3)%7)/7*math.tau)}
        # Prefix history is sampled by observation time and can never exceed cutoff availability.
        for mins in [2,5]:
            old=next((e['payload'] for e in reversed(self.en.fixes[:i+1])
                      if 0<=t-mins*60-e['payload']['timestamp']<=120),None)
            out[f'_lat_{mins}']=old['latitude'] if old else math.nan
            out[f'_lon_{mins}']=old['longitude'] if old else math.nan
        # Carry only readiness/routine and explicit intent features from the existing audited extractor.
        s=self.rich.snapshot(t)
        keys=['prior_long_stops','prior_unique_stations','known_confirmed_fuel_count',
              'hours_since_long_stop','observed_km_since_long_stop','observed_drive_h_since_long_stop',
              'hours_since_confirmed_fuel','observed_km_since_confirmed_fuel','observed_drive_h_since_confirmed_fuel',
              'long_stop_median_interval_h','long_stop_due_ratio','confirmed_fuel_median_interval_h','confirmed_fuel_due_ratio',
              'appOpenedWithin15Minutes','appOpenedWithinHour','app_openAgeSeconds',
              'app_foreground_count_30m','map_gesture_count_30m','station_select_count_30m','station_go_count_30m']
        out.update({k:s[k] for k in keys})
        return out

    def outcome(self,t):
        """Training labels only. Unknown future coverage is excluded, not made negative."""
        horizon=self.horizon;min_lead=self.min_lead
        if self.target=='confirmed_fuel':
            v=next((v for v in self.en.visits if t<v['arrival']<=t+horizon and self.rich.timing.truth.get(v['id'])=='fueled'),None)
            if v is not None:
                answer_time=max(known for known,vid,_ in self.rich.timing.labels if vid==v['id'])
                kind='useful_fuel' if v['arrival']-t>=min_lead else 'late_fuel'
                return dict(y=int(kind=='useful_fuel'),known_at=max(answer_time,v['known_end']),outcome=kind,visit=v['id'])
        v=next((v for v in self.en.visits if t<v['arrival']<=t+horizon),None)
        if v is not None:
            if v['terminal'] is None:return dict(y=None,known_at=math.inf,outcome='unresolved',visit=v['id'])
            lead=v['arrival']-t
            if self.target=='confirmed_fuel' and v['dwell']>=180:
                label=self.rich.timing.truth.get(v['id'])
                if label in ('not_fueling','not_a_stop'):
                    answer_time=max(known for known,vid,_ in self.rich.timing.labels if vid==v['id'])
                    return dict(y=0,known_at=max(answer_time,v['known_end'],t+horizon),outcome='answered_nonfuel_long',visit=v['id'])
                return dict(y=None,known_at=math.inf,outcome='unanswered_long',visit=v['id'])
            outcome='useful_long' if v['dwell']>=180 and lead>=min_lead else 'late_long' if v['dwell']>=180 else 'short'
            return dict(y=int(outcome=='useful_long'),known_at=max(v['known_end'],t+horizon) if self.target=='confirmed_fuel' else v['known_end'],outcome=outcome,visit=v['id'])
        # Require a fresh accepted fix in at least 75% of the following horizon of minute bins.
        covered=0
        for at in range(int(t)+60,int(t)+horizon+1,60):
            covered+=self.rich.timing.fix(at) is not None
        enough=covered>=math.ceil(.75*horizon/60) and t+horizon<=self.en.times[-1]
        return dict(y=0 if enough else None,known_at=t+horizon,outcome='tracked_no_encounter' if enough else 'unknown',visit='')


def route_match_score(row,history,minimum_examples=1,require_unanimous=False):
    """Same-person contrastive prefix retrieval, one vote per past encounter or ordinary-driving segment.

    Match current and two-minute-earlier positions and direction. Short-station
    detections and well-observed ordinary driving both vote against a fuel stop.
    No station preference, slowdown, final destination, or same-trip self-match.
    """
    nearest={}
    for h in history:
        if h['account']!=row['account'] or h['_trip']==row['_trip'] or h['known_at']>=row['cutoff']:continue
        heading=row['_heading'];old_heading=h['_heading']
        if not (0<=heading<360 and 0<=old_heading<360):continue
        if abs((heading-old_heading+180)%360-180)>60:continue
        d=distance((row['_lat'],row['_lon']),(h['_lat'],h['_lon']))
        if d>750:continue
        if any(not math.isfinite(x[k]) for x in [row,h] for k in ['_lat_2','_lon_2']):continue
        prefix=distance((row['_lat_2'],row['_lon_2']),(h['_lat_2'],h['_lon_2']))
        if prefix>1500:continue
        origin=distance((row['_origin_lat'],row['_origin_lon']),(h['_origin_lat'],h['_origin_lon']))
        cost=d+.5*prefix+.1*min(origin,5000)
        vid=h.get('visit')
        key=('encounter',vid) if isinstance(vid,str) and vid else ('segment',h['_trip'])
        if key not in nearest or cost<nearest[key][0]:nearest[key]=(cost,h)
    examples=sorted(nearest.values(),key=lambda x:x[0])[:8]
    if len(examples)<minimum_examples or (require_unanimous and any(h['y']!=1 for _,h in examples)):return 0.,len(examples)
    weights=[math.exp(-cost/600) for cost,h in examples]
    # A conservative weak negative prior prevents a distant single match becoming certainty.
    score=sum(w*h['y'] for w,(_,h) in zip(weights,examples))/(.25+sum(weights))
    return score,len(examples)
