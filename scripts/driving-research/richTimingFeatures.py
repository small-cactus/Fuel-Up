"""Outcome-independent pre-arrival features; no future station identity is used."""
import bisect
import math
import statistics
from backtestAnticipation import available
from destinationFeatures import DestinationFeatures, PersonalRouteMemory
from timingFeatures import TimingFeatures


def angle(a,b):return abs((a-b+180)%360-180)
def mean(xs):return statistics.mean(xs) if xs else math.nan

class RichTimingFeatures:
    def __init__(self,events,stations):
        self.engine=DestinationFeatures(events,stations)
        self.route=PersonalRouteMemory(self.engine)
        self.timing=TimingFeatures(events)

    def snapshot(self,t):
        en=self.engine;stop=bisect.bisect_right(en.times,t)
        history=en.events[:stop]
        recent=[e for e in history if available(e)>=t-1800]
        fi=bisect.bisect_right(en.fix_times,t)
        fixes=en.fixes[:fi];p=fixes[-1]['payload'] if fixes else None
        age=t-p['timestamp'] if p else math.nan
        fresh=p is not None and 0<=age<=120
        out={'fix_age_s':age,'fresh_location':int(fresh),
             'utc_hour_sin':math.sin(t%86400/86400*math.tau),
             'utc_hour_cos':math.cos(t%86400/86400*math.tau),
             'utc_weekday_sin':math.sin(((t//86400+3)%7)/7*math.tau),
             'utc_weekday_cos':math.cos(((t//86400+3)%7)/7*math.tau)}
        for k in ['speed','accuracy','speedAccuracy','courseAccuracy','altitudeMeters','verticalAccuracyMeters']:
            out[k]=p.get(k,math.nan) if fresh else math.nan
        for minutes in [1,3,10,30]:
            fs=[e['payload'] for e in fixes if t-minutes*60<=e['payload']['timestamp']<=t]
            speeds=[f['speed'] for f in fs if f.get('speed',-1)>=0]
            out[f'fixes_{minutes}m']=len(fs);out[f'speed_mean_{minutes}m']=mean(speeds)
            out[f'speed_std_{minutes}m']=statistics.pstdev(speeds) if speeds else math.nan
            out[f'stationary_fraction_{minutes}m']=mean([int(s<2.5) for s in speeds])
            out[f'speed_change_{minutes}m']=speeds[-1]-speeds[0] if len(speeds)>1 else math.nan
            turns=[angle(a['course'],b['course']) for a,b in zip(fs,fs[1:])
                   if 0<=a.get('course',-1)<360 and 0<=b.get('course',-1)<360 and b['timestamp']-a['timestamp']<=120]
            out[f'turn_mean_{minutes}m']=mean(turns)
        cs,_=en.candidates(t)
        for k in ['nearest_station_m','nearest_heading_cos','nearest_closing_mps','nearest_prior_count',
                  'heading_best_station_m','station_count_2km','station_count_ahead_2km']:
            out[k]=math.nan
        if cs:
            nearest=min(cs,key=lambda c:c['distance'])
            directional=max(cs,key=lambda c:-math.log1p(c['distance'])+2*c['heading_cos'])
            out.update(nearest_station_m=nearest['distance'],nearest_heading_cos=nearest['heading_cos'],
                nearest_closing_mps=nearest['x'][3],nearest_prior_count=nearest['history'],
                heading_best_station_m=directional['distance'],station_count_2km=sum(c['distance']<=2000 for c in cs),
                station_count_ahead_2km=sum(c['distance']<=2000 and c['heading_cos']>=.707 for c in cs))
        prior=[v for v in en.visits if v['known_end']<=t and v['dwell']>=180]
        out['prior_long_stops']=len(prior);out['prior_unique_stations']=len({v['station'] for v in prior})
        out['hours_since_long_stop']=(t-prior[-1]['arrival'])/3600 if prior else math.nan
        out['prior_route_positive_match']=int(self.route.predict(t,cs) is not None)
        for label,visits in [('long_stop',prior),('confirmed_fuel',self.timing.history(t))]:
            out[f'known_{label}_count']=len(visits)
            if visits:
                last=visits[-1]['arrival'];a=self.timing.totals(last);b=self.timing.totals(t)
                out[f'hours_since_{label}']=(t-last)/3600
                out[f'observed_km_since_{label}']=b[0]-a[0]
                out[f'observed_drive_h_since_{label}']=b[1]-a[1]
            else:
                for k in ['hours_since','observed_km_since','observed_drive_h_since']:out[f'{k}_{label}']=math.nan
            intervals=[(b['arrival']-a['arrival'])/3600 for a,b in zip(visits,visits[1:])]
            out[f'{label}_median_interval_h']=statistics.median(intervals) if len(intervals)>=2 else math.nan
            out[f'{label}_due_ratio']=out[f'hours_since_{label}']/statistics.median(intervals) if len(intervals)>=2 and statistics.median(intervals)>0 else math.nan
        motion={};mt=-math.inf;context={};network={};steps={};action_times={}
        for e in recent:
            q=e['payload'];et=available(e)
            if e['kind']=='motion' and mt<=q.get('timestamp',math.inf)<=t:motion=q;mt=q['timestamp']
            if q.get('source')=='apple_motion_history':
                for a in q.get('activities',[]):
                    if mt<=a['timestamp']<=t:motion=a;mt=a['timestamp']
            if 'contextAtReceipt' in q and q['contextAtReceipt'].get('sampledAt',et)<=t:
                context=q['contextAtReceipt'];network=q.get('networkAtReceipt',{})
            if q.get('source')=='apple_step_history' and q.get('status')=='available' and t-1800<=q.get('dataEndAt',t+1)<=t:
                steps[(q.get('dataStartAt'),q.get('dataEndAt'))]=q
            action=q.get('action',e['kind'] if e['kind'] in ['app_foreground','app_background','screen_view'] else None)
            if action:
                # Same UI action can be copied into both research and installation telemetry.
                action_times.setdefault(action,[]).append(et)
        for k in ['automotive','stationary','walking','running','cycling','unknown','confidence']:
            out['motion_'+k]=float(motion[k]) if k in motion else math.nan
        out['motion_age_s']=t-mt if mt>-math.inf else math.nan
        for k in ['batteryLevel','batteryState','lowPowerMode','thermalState','backgroundRefreshStatus',
                  'foregroundSessionActive','appOpenedWithin15Minutes','appOpenedWithinHour','app_openAgeSeconds']:
            out[k]=float(context[k]) if isinstance(context.get(k),(float,int)) else math.nan
        for k in ['known','available','wifi','expensive','constrained']:
            out['network_'+k]=float(network[k]) if k in network else math.nan
        ports=context.get('audioOutputPortTypes')
        out['audio_bluetooth']=int(any('Bluetooth' in p for p in ports)) if ports is not None else math.nan
        out['audio_car']=int(any('CarAudio' in p for p in ports)) if ports is not None else math.nan
        for k in ['steps','distanceMeters','floorsAscended','floorsDescended']:
            vs=[float(q[k]) for q in steps.values() if isinstance(q.get(k),(float,int))]
            out['pedometer_'+k+'_30m']=sum(vs) if vs else math.nan
        out['pedometer_pace_30m']=mean([q['averageActivePace'] for q in steps.values() if 'averageActivePace' in q])
        out['pedometer_history_bins']=len(steps)
        for a in ['app_foreground','app_background','screen_view','map_gesture','station_select','station_go']:
            times=[]
            for et in sorted(action_times.get(a,[])):
                if not times or et-times[-1]>1:times.append(et)
            out[a+'_count_30m']=len(times)
            out[a+'_age_s']=t-times[-1] if times else math.nan
        out['geofence_entries_30m']=sum(e['kind']=='geofence' and e['payload'].get('transition')=='enter' for e in recent)
        out['geofence_exits_30m']=sum(e['kind']=='geofence' and e['payload'].get('transition')=='exit' for e in recent)
        out['motion_events_30m']=sum(e['kind']=='motion' for e in recent)
        return out
