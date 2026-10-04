import unittest
import warnings
import numpy as np
from signals import history_features, corroborated_labels, split
from recurrence import prior_counts
from train import threshold_for
warnings.filterwarnings('ignore', category=RuntimeWarning)


class SignalsTest(unittest.TestCase):
    def arrays(self):
        p=np.full((40,1,1),3.,dtype='float32')
        s=np.arange(40,dtype='float32')[:,None,None]
        o=np.arange(40,dtype='float32')[:,None]
        return p,s,o

    def test_future_cannot_change_features(self):
        p,s,o=self.arrays(); idx=np.array([0]);t=np.array([10])
        names,x=history_features(p,s,o,idx,idx,t)
        p[11:]=12;s[11:]=-100;o[11:]=999
        _,other=history_features(p,s,o,idx,idx,t)
        np.testing.assert_allclose(x,other,equal_nan=True)
        self.assertEqual(x[0,names.index('unchanged_refresh_count_24')],10)

    def test_requires_two_new_timestamps(self):
        p,s,o=self.arrays();p[11:]=3.2;s[11:]=11
        y,end,*_=corroborated_labels(p,s,o,np.array([0]),np.array([0]),np.array([10]))
        self.assertEqual(y[0],-1);self.assertTrue(np.isnan(end[0]))

    def test_transient_and_confirmed_are_distinct(self):
        p,s,o=self.arrays();p[11]=3.2
        args=(np.array([0]),np.array([0]),np.array([10]))
        self.assertEqual(corroborated_labels(p,s,o,*args)[0][0],-1)
        p[12]=3.21
        y,end,*_=corroborated_labels(p,s,o,*args)
        self.assertEqual(y[0],1);self.assertEqual(end[0],12)

    def test_missing_followup_is_unknown(self):
        p,s,o=self.arrays();s[11:]=10
        self.assertEqual(corroborated_labels(p,s,o,np.array([0]),np.array([0]),np.array([10]))[0][0],-1)

    def test_stable_requires_observed_confirmation(self):
        p,s,o=self.arrays()
        y,end,*_=corroborated_labels(p,s,o,np.array([0]),np.array([0]),np.array([10]))
        self.assertEqual(y[0],0);self.assertEqual(end[0],12)

    def test_label_split_purge(self):
        at=np.array([20,47,48,59,60]);end=np.array([22,49,50,61,70])
        np.testing.assert_array_equal(split(at,end),[0,-1,1,-1,2])

    def test_future_source_is_not_a_valid_report(self):
        p,s,o=self.arrays();s[11:]=100
        self.assertEqual(corroborated_labels(p,s,o,np.array([0]),np.array([0]),np.array([10]))[0][0],-1)

    def test_recurrence_evidence_must_be_available_before_prediction(self):
        at=np.array([10.,10.,11.,12.,13.,20.])
        sid=np.array([1,1,1,1,1,2]);product=np.array([0,1,0,0,0,0])
        confirmed=np.array([12.,12.,np.nan,np.nan,np.nan,np.nan])
        a,b=prior_counts(at,sid,product,confirmed)
        np.testing.assert_array_equal(a,[0,0,0,0,1,0])
        np.testing.assert_array_equal(b,[0,0,0,0,1,0])
        # Another future confirmed episode cannot change earlier predictions.
        confirmed[4]=18
        a2,b2=prior_counts(at,sid,product,confirmed)
        np.testing.assert_array_equal(a,a2);np.testing.assert_array_equal(b,b2)

    def test_threshold_requires_minimum_evidence(self):
        self.assertIsNone(threshold_for(np.ones(29),np.linspace(.5,1,29)))
        self.assertIsNone(threshold_for(np.zeros(100),np.linspace(0,1,100)))
        y=np.r_[np.zeros(70),np.ones(30)];p=np.linspace(0,1,100)
        threshold=threshold_for(y,p);flags=p>=threshold
        self.assertGreaterEqual(flags.sum(),30)
        self.assertGreaterEqual(y[flags].mean(),.7)

if __name__=='__main__': unittest.main()
