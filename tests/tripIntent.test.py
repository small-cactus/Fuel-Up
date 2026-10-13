"""Intent replay safety: future data, route negatives, and useful warning lead."""
import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts/driving-research'))
from richTimingFeatures import RichTimingFeatures
from tripIntentFeatures import TripIntentFeatures,route_match_score


def event(kind,t,**payload):return dict(id=f'{kind}-{t}',kind=kind,recordedAt=t,payload=payload)
def fix(t,speed=10,lon=0):return event('location',t,timestamp=t,receivedAt=t,latitude=0,longitude=lon,accuracy=5,speed=speed,course=90,simulated=False,quality='accepted')
def visit(t,end):return [event('visit_observation',t,visitId='v',stationId='A',startedAt=t,lastInsideAt=t),event('visit_departure',end,visitId='v',stationId='A',startedAt=t,lastInsideAt=end)]
def route(trip,t,y=1,known=500,account=1):
    return dict(account=account,cutoff=t,_trip=trip,_lat=0.,_lon=0.,_heading=90.,_lat_2=0.,_lon_2=-.001,
                _origin_lat=0.,_origin_lon=-.01,y=y,known_at=known)

class TripIntentTests(unittest.TestCase):
    def test_cutoff_features_unchanged_by_future_trip_and_label(self):
        es=[fix(100),fix(160,lon=.001)]
        f=TripIntentFeatures(RichTimingFeatures(es,{})).snapshot(160)
        future=visit(700,1000)+[fix(800,lon=1),event('visit_label',1100,visitId='v',label='fueled')]
        g=TripIntentFeatures(RichTimingFeatures(es+future,{})).snapshot(160)
        self.assertEqual(f.keys(),g.keys())
        for k in f:
            if isinstance(f[k],float) and math.isnan(f[k]):self.assertTrue(math.isnan(g[k]),k)
            else:self.assertEqual(f[k],g[k],k)

    def test_no_speed_or_braking_features(self):
        f=TripIntentFeatures(RichTimingFeatures([fix(100)],{})).snapshot(100)
        self.assertFalse(any('speed' in k or 'closing' in k or 'station_m' in k for k in f))

    def test_route_recovery_requires_past_outcome(self):
        now=route(2,1000)
        self.assertEqual(route_match_score(now,[route(1,100,known=1100)])[1],0)
        self.assertGreater(route_match_score(now,[route(1,100,known=500)])[0],.5)

    def test_short_and_ordinary_negative_routes_reduce_score(self):
        now=route(5,1000);positive=route(1,100);negative=route(2,200,y=0)
        self.assertGreater(route_match_score(now,[positive])[0],.5)
        self.assertLess(route_match_score(now,[positive,negative])[0],.5)

    def test_route_rows_from_same_segment_get_only_one_vote(self):
        now=route(5,1000);a=route(1,100)
        self.assertEqual(route_match_score(now,[a]),route_match_score(now,[a,dict(a,cutoff=110)]))

    def test_one_encounter_split_by_gps_gap_is_not_two_positive_votes(self):
        now=route(5,1000);a=dict(route(1,100),visit='same');b=dict(route(2,200),visit='same')
        self.assertEqual(route_match_score(now,[a]),route_match_score(now,[a,b]))

    def test_other_person_and_same_current_trip_cannot_supply_route_memory(self):
        now=route(5,1000)
        self.assertEqual(route_match_score(now,[route(5,100),route(1,100,account=2)])[1],0)

    def test_less_than_five_minutes_is_too_late(self):
        f=TripIntentFeatures(RichTimingFeatures([fix(100)]+visit(350,550),{}))
        self.assertEqual(f.outcome(100)['outcome'],'late_long')
        self.assertEqual(f.outcome(50)['outcome'],'useful_long')

    def test_precision_gate_vetoes_any_matched_negative(self):
        now=route(8,1000);history=[route(i,100+i,y=1) for i in range(3)]
        self.assertGreater(route_match_score(now,history,minimum_examples=3,require_unanimous=True)[0],.9)
        self.assertEqual(route_match_score(now,history+[route(4,200,y=0)],minimum_examples=3,require_unanimous=True)[0],0)

    def test_precision_gate_requires_independent_history(self):
        now=route(8,1000)
        self.assertEqual(route_match_score(now,[route(1,100),route(2,200)],minimum_examples=3,require_unanimous=True)[0],0)

    def test_configured_ten_minute_minimum_cannot_count_seven_minute_warning(self):
        f=TripIntentFeatures(RichTimingFeatures([fix(100)]+visit(550,750),{}),min_lead=600,horizon=1800)
        self.assertEqual(f.outcome(100)['outcome'],'late_long')
        self.assertEqual(f.outcome(-50)['outcome'],'useful_long')

    def test_confirmed_fuel_target_allows_passing_a_different_station(self):
        es=[fix(100)]+visit(800,1000)+[event('visit_label',1100,visitId='v',label='fueled')]
        es += [event('visit_observation',200,visitId='pass',stationId='B',startedAt=200,lastInsideAt=200),
               event('visit_departure',230,visitId='pass',stationId='B',startedAt=200,lastInsideAt=230)]
        f=TripIntentFeatures(RichTimingFeatures(es,{}),min_lead=600,horizon=1800,target='confirmed_fuel')
        self.assertEqual(f.outcome(100)['outcome'],'useful_fuel')
        self.assertEqual(f.outcome(100)['known_at'],1100)
        self.assertEqual(TripIntentFeatures(RichTimingFeatures(es,{})).outcome(100)['outcome'],'short')

    def test_unanswered_long_stop_does_not_become_confirmed_positive(self):
        f=TripIntentFeatures(RichTimingFeatures([fix(100)]+visit(800,1000),{}),min_lead=600,horizon=1800,target='confirmed_fuel')
        self.assertIsNone(f.outcome(100)['y'])

    def test_fuel_target_negative_waits_until_horizon_finishes(self):
        f=TripIntentFeatures(RichTimingFeatures([fix(100)]+visit(200,230),{}),min_lead=600,horizon=1800,target='confirmed_fuel')
        self.assertEqual(f.outcome(100)['known_at'],1900)

    def test_answered_store_visit_supplies_negative_evidence(self):
        es=[fix(100)]+visit(800,1000)+[event('visit_label',1100,visitId='v',label='not_fueling')]
        f=TripIntentFeatures(RichTimingFeatures(es,{}),min_lead=600,horizon=1800,target='confirmed_fuel')
        self.assertEqual(f.outcome(100)['y'],0)
        self.assertEqual(f.outcome(100)['outcome'],'answered_nonfuel_long')

    def test_no_future_coverage_is_unknown_not_negative(self):
        f=TripIntentFeatures(RichTimingFeatures([fix(100)],{}))
        self.assertIsNone(f.outcome(100)['y'])
        self.assertEqual(f.outcome(100)['outcome'],'unknown')

    def test_ordinary_well_observed_driving_is_negative(self):
        f=TripIntentFeatures(RichTimingFeatures([fix(t) for t in range(100,1401,60)],{}))
        self.assertEqual(f.outcome(100)['y'],0)
        self.assertEqual(f.outcome(100)['outcome'],'tracked_no_encounter')

if __name__=='__main__':unittest.main()
