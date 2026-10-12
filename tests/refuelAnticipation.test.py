"""Synthetic causal and unknown-outcome checks; no participant data."""
import importlib.util
from pathlib import Path
import unittest
s=importlib.util.spec_from_file_location('anticipation',Path(__file__).parents[1]/'scripts/driving-research/backtestAnticipation.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

def event(i,kind,t,**p):
    return {'id':str(i),'kind':kind,'recordedAt':t,'serverReceivedAt':'2026-01-01T00:00:00Z','payload':p}
def fix(i,t,lat=0,lon=-0.009,receipt=None):
    return event(i,'location',receipt or t,timestamp=t,receivedAt=receipt or t,latitude=lat,longitude=lon,
                 accuracy=5,speed=10,course=90,simulated=False,quality='accepted')
def visit(i,t,sid='A'):
    return event('v'+i,'visit_observation',t,visitId=i,stationId=sid,startedAt=t,lastInsideAt=t)
def label(i,t,value='fueled'):
    return event('l'+i+str(t),'visit_label',t,visitId=i,stationId='A',label=value,labeledAt=t)

class Causality(unittest.TestCase):
    def test_future_catalog_is_not_available(self):
        r=m.Replay([fix(1,100),event(2,'station_catalog',200,stationIds=['A'])],[{'station_id':'A','latitude':0,'longitude':0}])
        self.assertIsNone(r.predict(100)['catalog_approach'])
        self.assertEqual(r.predict(200)['catalog_approach'],'A')

    def test_delayed_fix_not_backdated(self):
        r=m.Replay([fix(1,100,receipt=120)],[])
        self.assertIsNone(r.fix(110))
        self.assertIsNotNone(r.fix(120))

    def test_label_is_available_only_after_answer_and_corrections_apply(self):
        r=m.Replay([fix(1,100,lon=0),visit('one',100),label('one',200),label('one',300,'not_fueling')],[])
        self.assertIsNone(r.predict(199)['habit'])
        self.assertEqual(r.predict(200)['habit'],'A')
        self.assertIsNone(r.predict(300)['habit'])

    def test_future_outcomes_cannot_change_past_prediction(self):
        prefix=[fix(1,100,lon=0),visit('one',100),label('one',200),fix(2,500)]
        future=[fix(3,800,lon=0.1),visit('two',800,'B'),label('two',900,'not_fueling')]
        self.assertEqual(m.Replay(prefix,[]).predict(500),m.Replay(prefix+future,[]).predict(500))

    def test_invalid_and_stale_fix_abstention(self):
        r=m.Replay([fix(1,100),fix(2,150,receipt=200)],[])
        self.assertIsNone(r.fix(221))
        self.assertEqual(len(r.fixes),1)

    def test_unanswered_visit_not_negative(self):
        r=m.Replay([fix(1,100),visit('one',100)],[])
        self.assertEqual(r.targets,[])
        self.assertEqual(r.truth,{})

    def test_route_label_not_available_early(self):
        events=[fix(1,100),fix(2,300,lon=0),visit('one',300),label('one',600),fix(3,500)]
        self.assertIsNone(m.Replay(events,[]).predict(500)['prior_route'])
        events.append(fix(4,700))
        self.assertEqual(m.Replay(events,[]).predict(700)['prior_route'],'A')

if __name__=='__main__': unittest.main()
