import unittest
import numpy as np
from features import source_events,label_pairs,split_for
from evaluate import ranking_metrics

class CausalityTests(unittest.TestCase):
    def test_repeat_report_not_extra_example(self):
        events,_=source_events(np.array([3.,3.,3.2]),np.array([0.,0.,2.]),np.array([1.,2.,3.]))
        self.assertEqual(events,[0,2])
    def test_conflicting_source_excluded(self):
        events,n=source_events(np.array([3.,4.,4.]),np.array([0.,0.,2.]),np.array([1.,2.,3.]))
        self.assertEqual(events,[2]);self.assertEqual(n,1)
    def test_future_source_excluded(self):
        events,_=source_events(np.array([3.]),np.array([5.]),np.array([1.]))
        self.assertEqual(events,[])
    def test_next_advancing_source_and_missing_outcome(self):
        events=[0,1,2,3];sources=np.array([1.,.5,2.,3.]);obs=np.array([2.,3.,4.,30.])
        self.assertEqual(list(label_pairs(events,sources,obs)),[(0,0,2),(1,1,2)])
    def test_boundary_purge(self):
        self.assertEqual(split_for(71,73),-1);self.assertEqual(split_for(71,71.9),0)
        self.assertEqual(split_for(72,73),1);self.assertEqual(split_for(119,120),-1)
    def test_unknown_winner_not_removed(self):
        raw=np.array([2.,3.,4.,5.,6.]);y=np.array([np.nan,0,0,0,0]);meta=np.zeros((5,7));meta[:,0]=np.arange(5);meta[:,4]=1
        result=ranking_metrics(raw,y,np.zeros(5),meta)
        self.assertEqual(result['unknown_panels'],1);self.assertEqual(result['known_panels'],0)

if __name__=='__main__':unittest.main()
