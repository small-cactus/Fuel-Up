"""Leakage and label-construction gates for offline station destination replay."""
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts/driving-research'))
from destinationFeatures import DestinationFeatures, PersonalRouteMemory, FEATURES, visits_from

def event(kind,t,**p):return dict(id=f'{kind}-{t}',kind=kind,recordedAt=t,payload=p)
def fix(t,receipt=None):
    return event('location',receipt or t,timestamp=t,receivedAt=receipt or t,latitude=0,longitude=0,
                 accuracy=5,speed=10,course=90,simulated=False,quality='accepted')
def observation(t,sid='A'):
    return event('visit_observation',t,visitId='v',stationId=sid,startedAt=t,lastInsideAt=t)
def terminal(start,end,kind='visit_departure'):
    return event(kind,end,visitId='v',stationId='A',startedAt=start,lastInsideAt=end)
COORDS={'A':(0,.001),'B':(0,.002)}
class DestinationTests(unittest.TestCase):
    def test_gate_accepts_integer_weights_and_learns_direction(self):
        from backtestDestination import fit, score
        rows=[dict(x=[float(i)]+[0.]*(len(FEATURES)-1),y=int(i>0),weight=1) for i in [-3,-2,-1,1,2,3]]
        model=fit(rows,balance=False)
        values=score(model,rows)
        self.assertLess(values[0],.5);self.assertGreater(values[-1],.5)

    def test_target_not_injected_or_future_catalog_used(self):
        es=[fix(100),event('station_catalog',200,stationIds=['A']),observation(300)]
        self.assertEqual(DestinationFeatures(es,COORDS).candidates(100)[0],[])
    def test_delayed_and_stale_location_abstain(self):
        es=[event('station_catalog',10,stationIds=['A']),fix(100,120)]
        f=DestinationFeatures(es,COORDS)
        self.assertFalse(f.candidates(110)[0]);self.assertTrue(f.candidates(120)[0]);self.assertFalse(f.candidates(221)[0])
    def test_future_events_cannot_change_features(self):
        prefix=[event('station_catalog',10,stationIds=['A']),fix(100)]
        future=[event('station_catalog',110,stationIds=['B']),observation(120),terminal(120,400),
                event('usage',150,action='station_go',stationId='B')]
        self.assertEqual(DestinationFeatures(prefix,COORDS).candidates(100),DestinationFeatures(prefix+future,COORDS).candidates(100))
    def test_duration_uses_last_inside_not_late_departure(self):
        e=terminal(100,200);e['payload']['departedAt']=900;e['recordedAt']=900
        v=visits_from([observation(100),e])[0]
        self.assertEqual(v['dwell'],100)
    def test_three_minute_boundary_and_gap_censor(self):
        for seconds,positive in [(179,False),(180,True)]:
            v=visits_from([observation(100),terminal(100,100+seconds,'visit_gap')])[0]
            self.assertEqual(v['dwell']>=180,positive);self.assertEqual(v['terminal'],'visit_gap')
    def test_history_not_known_until_terminal_received(self):
        es=[event('station_catalog',10,stationIds=['A']),observation(100),terminal(100,300),fix(250)]
        cs,_=DestinationFeatures(es,COORDS).candidates(250)
        self.assertEqual(cs[0]['history'],0)
    def test_late_motion_history_not_backdated(self):
        es=[event('station_catalog',10,stationIds=['A']),fix(100),
            event('diagnostic',120,source='apple_motion_history',activities=[{'timestamp':90,'automotive':True}])]
        f=DestinationFeatures(es,COORDS)
        self.assertEqual(f.candidates(100)[0][0]['x'][FEATURES.index('automotive')],0)
        self.assertEqual(f.candidates(120)[0][0]['x'][FEATURES.index('automotive')],1)
    def test_route_memory_waits_until_past_outcome_is_available(self):
        es=[event('station_catalog',10,stationIds=['A']),fix(100),observation(300),terminal(300,500),fix(450),fix(600)]
        f=DestinationFeatures(es,COORDS); memory=PersonalRouteMemory(f)
        self.assertIsNone(memory.predict(450,f.candidates(450)[0]))
        self.assertEqual(memory.predict(600,f.candidates(600)[0]),'A')
    def test_short_prior_encounter_vetoes_route_prediction(self):
        es=[event('station_catalog',10,stationIds=['A']),fix(100),observation(300),terminal(300,400),fix(600)]
        f=DestinationFeatures(es,COORDS)
        self.assertIsNone(PersonalRouteMemory(f).predict(600,f.candidates(600)[0]))
    def test_repeated_step_windows_not_double_counted(self):
        step=dict(source='apple_step_history',status='available',dataStartAt=10,dataEndAt=50,steps=20)
        es=[event('station_catalog',10,stationIds=['A']),event('diagnostic',60,**step),event('diagnostic',70,**step),fix(100)]
        self.assertEqual(DestinationFeatures(es,COORDS).candidates(100)[0][0]['x'][FEATURES.index('steps_30m')],20)
if __name__=='__main__':unittest.main()
