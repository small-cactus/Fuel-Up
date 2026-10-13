"""Causal and missing-data checks for the richer offline signal study."""
import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts/driving-research'))
from richTimingFeatures import RichTimingFeatures


def event(kind,t,**payload):return dict(id=f'{kind}-{t}',kind=kind,recordedAt=t,payload=payload)
def fix(t,receipt=None,speed=10):
    return event('location',receipt or t,timestamp=t,receivedAt=receipt or t,latitude=0,longitude=0,
                 accuracy=5,speed=speed,course=90,simulated=False,quality='accepted')
COORDS={'A':(0,.001),'B':(0,.002)}


class RichTimingTests(unittest.TestCase):
    def assertSnapshotEqual(self,a,b):
        self.assertEqual(a.keys(),b.keys())
        for k in a:
            if isinstance(a[k],float) and math.isnan(a[k]):self.assertTrue(math.isnan(b[k]),k)
            else:self.assertEqual(a[k],b[k],k)

    def test_future_events_do_not_change_cutoff(self):
        prefix=[event('station_catalog',10,stationIds=['A']),fix(100)]
        future=[fix(120),event('diagnostic',130,contextAtReceipt={'sampledAt':130,'batteryLevel':.4}),
                event('usage',140,action='station_go',stationId='B'),
                event('visit_observation',150,visitId='v',stationId='B',startedAt=150,lastInsideAt=150),
                event('visit_departure',400,visitId='v',stationId='B',startedAt=150,lastInsideAt=400),
                event('visit_label',410,visitId='v',label='fueled',labeledAt=410)]
        self.assertSnapshotEqual(RichTimingFeatures(prefix,COORDS).snapshot(100),RichTimingFeatures(prefix+future,COORDS).snapshot(100))

    def test_delayed_recovery_not_backdated(self):
        es=[event('diagnostic',120,source='apple_motion_history',activities=[dict(timestamp=90,automotive=True)]),
            event('diagnostic',120,source='apple_step_history',status='available',dataStartAt=60,dataEndAt=100,steps=22)]
        f=RichTimingFeatures(es,{})
        before=f.snapshot(100);after=f.snapshot(120)
        self.assertTrue(math.isnan(before['motion_automotive']))
        self.assertTrue(math.isnan(before['pedometer_steps_30m']))
        self.assertEqual(after['motion_automotive'],1);self.assertEqual(after['pedometer_steps_30m'],22)

    def test_duplicate_step_window_and_copied_action(self):
        step=dict(source='apple_step_history',status='available',dataStartAt=10,dataEndAt=50,steps=20)
        es=[event('diagnostic',60,**step),event('diagnostic',70,**step),
            event('usage',90,action='station_go'),event('usage',90.5,action='station_go')]
        s=RichTimingFeatures(es,{}).snapshot(100)
        self.assertEqual(s['pedometer_steps_30m'],20);self.assertEqual(s['station_go_count_30m'],1)

    def test_location_receipt_and_freshness(self):
        f=RichTimingFeatures([fix(100,120)],{})
        self.assertEqual(f.snapshot(110)['fresh_location'],0)
        self.assertEqual(f.snapshot(120)['fresh_location'],1)
        self.assertTrue(math.isnan(f.snapshot(221)['speed']))

    def test_future_station_not_injected(self):
        f=RichTimingFeatures([fix(100),event('station_catalog',120,stationIds=['A'])],COORDS)
        self.assertTrue(math.isnan(f.snapshot(100)['nearest_station_m']))
        self.assertLess(f.snapshot(120)['nearest_station_m'],200)

    def test_confirmed_fuel_requires_answer_known_then(self):
        es=[event('visit_observation',100,visitId='v',stationId='A',startedAt=100,lastInsideAt=100),
            event('visit_departure',300,visitId='v',stationId='A',startedAt=100,lastInsideAt=300),
            event('visit_label',400,visitId='v',label='fueled',labeledAt=400)]
        f=RichTimingFeatures(es,COORDS)
        self.assertEqual(f.snapshot(350)['prior_long_stops'],1)
        self.assertEqual(f.snapshot(350)['known_confirmed_fuel_count'],0)
        self.assertEqual(f.snapshot(400)['known_confirmed_fuel_count'],1)
        self.assertTrue(math.isnan(f.snapshot(400)['confirmed_fuel_median_interval_h']))

    def test_missing_optional_context_stays_missing(self):
        s=RichTimingFeatures([fix(100)],{}).snapshot(100)
        for key in ['batteryLevel','appOpenedWithin15Minutes','audio_bluetooth','pedometer_steps_30m']:
            self.assertTrue(math.isnan(s[key]),key)
        self.assertEqual(s['station_go_count_30m'],0)

    def test_speed_change_uses_past_samples(self):
        s=RichTimingFeatures([fix(40,speed=20),fix(90,speed=5),fix(110,speed=50)],{}).snapshot(100)
        self.assertEqual(s['speed_change_1m'],-15)
        self.assertEqual(s['speed_mean_1m'],12.5)

if __name__=='__main__':unittest.main()
