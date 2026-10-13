"""Causal candidate-station features for offline destination experiments."""
import bisect
import collections
import math
from backtestAnticipation import available, bearing, distance, valid_fix

CONTEXT = ['batteryLevel', 'batteryState', 'lowPowerMode', 'thermalState',
           'backgroundRefreshStatus', 'foregroundSessionActive', 'appOpenedWithin15Minutes',
           'appOpenedWithinHour', 'app_openAgeSeconds', 'map_gestureAgeSeconds',
           'station_selectAgeSeconds', 'station_goAgeSeconds']
MOTION = ['automotive', 'stationary', 'walking', 'running', 'cycling', 'unknown', 'confidence']
BASE = ['log_distance', 'heading_cos', 'heading_available', 'closing_mps', 'closing_available',
        'speed', 'accuracy', 'fix_age', 'prior_station_fraction', 'prior_station_count',
        'hour_sin', 'hour_cos', 'weekday_sin', 'weekday_cos', 'same_go', 'same_selection',
        'motion_age', 'steps_30m', 'steps_available', 'wifi', 'network_available']
FEATURES = BASE + MOTION + [s for k in CONTEXT for s in (k, k+'_missing')]


def visits_from(events):
    visits = {}
    for e in sorted(events, key=available):
        if e['kind'] not in ('visit_observation', 'visit_candidate', 'visit_departure', 'visit_gap'):
            continue
        p = e['payload']; vid = p['visitId']
        v = visits.setdefault(vid, dict(id=vid, station=str(p['stationId']), arrival=p['startedAt'],
                                       dwell=0, terminal=None, known_end=float('inf')))
        v['dwell'] = max(v['dwell'], p['lastInsideAt']-p['startedAt'])
        if e['kind'] in ('visit_departure', 'visit_gap'):
            v['terminal'] = e['kind']; v['known_end'] = available(e)
    return sorted(visits.values(), key=lambda v:v['arrival'])


class DestinationFeatures:
    def __init__(self, events, stations):
        self.events = sorted(events, key=available)
        self.times = [available(e) for e in self.events]
        self.fixes = [e for e in self.events if e['kind']=='location' and valid_fix(e)]
        self.fix_times = [available(e) for e in self.fixes]
        self.stations = stations
        self.visits = visits_from(self.events)
        self.known = {}
        for e in self.events:
            p = e['payload']; ids = p.get('stationIds', []) if e['kind']=='station_catalog' else []
            if e['kind'].startswith('visit_') and p.get('stationId'): ids = ids+[p['stationId']]
            for sid in ids: self.known.setdefault(str(sid), available(e))

    def candidates(self, t):
        i = bisect.bisect_right(self.fix_times,t)-1
        if i<0: return [], 'no_location'
        p = self.fixes[i]['payload']
        if not 0<=t-p['timestamp']<=120: return [], 'stale_location'
        point = (p['latitude'],p['longitude'])
        earlier = next((e['payload'] for e in reversed(self.fixes[:i])
                        if 30<=p['timestamp']-e['payload']['timestamp']<=300),None)
        prior = [v for v in self.visits if v['known_end']<=t and v['dwell']>=180]
        counts = collections.Counter(v['station'] for v in prior)
        end = bisect.bisect_right(self.times,t)
        recent = [e for e in self.events[:end] if available(e)>=t-1800]
        context = {}; network = {}; motion = {}; mt = None; steps = 0; step_available = False
        go = select = None; go_t = select_t = -float('inf'); offset=0
        # New context is captured at receipt. Recovered history never backdates availability.
        for e in recent:
            q=e['payload']; et=available(e)
            if q.get('contextAtReceipt',{}).get('sampledAt',et)<=t and 'contextAtReceipt' in q:
                context=q['contextAtReceipt']; network=q.get('networkAtReceipt',{})
            offset=q.get('receiptUTCOffsetSeconds',offset)
            if e['kind']=='motion' and q.get('timestamp',t+1)<=t:
                motion=q;mt=q['timestamp']
            if q.get('source')=='apple_motion_history':
                for a in q.get('activities',[]):
                    if a['timestamp']<=t and (mt is None or a['timestamp']>mt):motion=a;mt=a['timestamp']
            if q.get('source')=='apple_step_history' and q.get('status')=='available' and q.get('dataEndAt',t+1)<=t:
                # Windows can repeat; unique data windows below prevent double counting.
                step_available=True
            action=q.get('action');sid=q.get('stationId',q.get('station',{}).get('id'))
            if action=='station_go' and sid: go=str(sid);go_t=et
            if action=='station_select' and sid: select=str(sid);select_t=et
        step_windows={}
        for e in recent:
            q=e['payload']
            if q.get('source')=='apple_step_history' and q.get('status')=='available' and t-1800<=q.get('dataEndAt',t+1)<=t:
                step_windows[(q.get('dataStartAt'),q.get('dataEndAt'))]=q.get('steps',0)
        steps=sum(step_windows.values())
        hour=(t+offset)%86400/86400*2*math.pi
        day=((t+offset)//86400+3)%7/7*2*math.pi
        heading=p.get('course',-1); has_heading=0<=heading<360 and p.get('speed',-1)>=2.5
        rows=[]
        for sid,seen in self.known.items():
            if seen>t or sid not in self.stations:continue
            coord=self.stations[sid];d=distance(point,coord)
            if d>25000:continue
            cosine=math.cos(math.radians(bearing(point,coord)-heading)) if has_heading else 0
            closing=(distance((earlier['latitude'],earlier['longitude']),coord)-d)/(p['timestamp']-earlier['timestamp']) if earlier else 0
            x=[math.log1p(d),cosine,int(has_heading),max(-70,min(70,closing)),int(earlier is not None),
               max(-1,min(70,p.get('speed',-1))),p['accuracy'],t-p['timestamp'],counts[sid]/max(1,len(prior)),
               math.log1p(counts[sid]),math.sin(hour),math.cos(hour),math.sin(day),math.cos(day),
               int(sid==go and t-go_t<=1800),int(sid==select and t-select_t<=1800),
               min(1800,t-mt) if mt is not None else 1800,steps,int(step_available),
               int(network.get('wifi',False)),int(network.get('available',False))]
            x += [float(motion.get(k,0)) for k in MOTION]
            for k in CONTEXT:
                value=context.get(k);x.extend([float(value) if isinstance(value,(int,float)) else 0,
                                              int(not isinstance(value,(int,float)))])
            rows.append(dict(station=sid,x=x,distance=d,heading_cos=cosine,history=counts[sid]))
        return rows,'available' if rows else 'no_known_station_with_coordinates'

class PersonalRouteMemory:
    """Retrieve same-person completed encounters, including shorter-stop negatives.

    This is a frozen analogue rule: within 300m and 45 degrees of a past
    approach, predict that approach's destination only if it led to a long stop.
    """
    def __init__(self, engine):
        self.engine=engine
        self.templates=[]
        for v in engine.visits:
            if v['terminal'] is None:continue
            lo=bisect.bisect_left(engine.fix_times,v['arrival']-900)
            hi=bisect.bisect_right(engine.fix_times,v['arrival']-60)
            for e in engine.fixes[lo:hi]:
                p=e['payload']
                if p.get('speed',-1)>=2.5 and 0<=p.get('course',-1)<360:
                    self.templates.append((v,p))

    def predict(self,t,candidates):
        i=bisect.bisect_right(self.engine.fix_times,t)-1
        if i<0:return None
        p=self.engine.fixes[i]['payload']
        if not 0<=t-p['timestamp']<=120 or p.get('speed',-1)<2.5 or not 0<=p.get('course',-1)<360:return None
        allowed={c['station'] for c in candidates};matches=[]
        for v,q in self.templates:
            if v['known_end']>t:continue
            angle=abs((p['course']-q['course']+180)%360-180)
            if angle>45:continue
            d=distance((p['latitude'],p['longitude']),(q['latitude'],q['longitude']))
            if d<=300:
                # Negative evidence participates even if its station is no longer in the candidate set.
                matches.append((d,v['dwell']>=180,-v['arrival'],v['station']))
        if not matches:return None
        _,positive,_,sid=min(matches)
        return sid if positive and sid in allowed else None
