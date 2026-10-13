"""Only answers known before fitting may qualify route positives."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts/driving-research'))
from backtestTripIntent import answered_route_history

class AnswersTests(unittest.TestCase):
    def test_later_answer_cannot_promote_training_positive(self):
        h=[dict(account=1,visit='v',outcome='useful_long',y=1)]
        fs=[(1,SimpleNamespace(timing=SimpleNamespace(labels=[(200,'v','fueled')])))]
        self.assertEqual(answered_route_history(h,fs,100),[])
        self.assertEqual(answered_route_history(h,fs,201)[0]['y'],1)

    def test_known_store_stop_is_negative_despite_long_duration(self):
        h=[dict(account=1,visit='v',outcome='useful_long',y=1)]
        fs=[(1,SimpleNamespace(timing=SimpleNamespace(labels=[(50,'v','not_fueling')])))]
        self.assertEqual(answered_route_history(h,fs,100)[0]['y'],0)

if __name__=='__main__':unittest.main()
