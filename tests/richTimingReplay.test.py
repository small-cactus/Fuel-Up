"""Clock replay must count misses, respect cooldown, and avoid arrival anchoring."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts/driving-research'))
from replayRichTiming import score_alerts


def visit(vid,t,dwell):return dict(id=vid,arrival=t,dwell=dwell,terminal='visit_departure')
def feature(visits,labels=None):return SimpleNamespace(engine=SimpleNamespace(visits=visits),timing=SimpleNamespace(truth=labels or {}))
def row(t,p=.6):return dict(account=1,t=t,p=p)

class ReplayTests(unittest.TestCase):
    def test_short_first_encounter_cannot_be_skipped_for_later_positive(self):
        f=feature([visit('short',110,10),visit('long',300,200)])
        r=score_alerts([row(100)],[(1,f)],.5)
        self.assertEqual(r['outcomes'],{'short_stop':1})

    def test_no_encounter_is_reported_as_unknown_not_true_negative(self):
        r=score_alerts([row(100)],[(1,feature([]))],.5)
        self.assertEqual(r['outcomes'],{'no_observed_encounter':1})
        self.assertEqual(r['actual_answered_outcomes'],{'no_observed_encounter':1})

    def test_cooldown_and_daily_limit(self):
        r=score_alerts([row(100),row(200),row(2000),row(4000),row(86500)],[(1,feature([]))],.5)
        self.assertEqual(r['alerts'],3)

    def test_duration_and_fueling_truth_remain_distinct(self):
        f=feature([visit('v',150,200)],{'v':'not_fueling'})
        r=score_alerts([row(100)],[(1,f)],.5)
        self.assertEqual(r['outcomes'],{'long_stop':1})
        self.assertEqual(r['actual_answered_outcomes'],{'not_fueling':1})
        self.assertEqual(r['unique_long_stops_matched'],1)

if __name__=='__main__':unittest.main()
