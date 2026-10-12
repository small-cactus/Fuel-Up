"""Timing-only replay causality and independence checks using synthetic records."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/driving-research'))
from timingFeatures import TimingFeatures
from backtestTiming import evaluate


def event(i, kind, t, **payload):
    return {'id': str(i), 'kind': kind, 'recordedAt': t, 'payload': payload, 'serverReceivedAt': '2099-01-01T00:00:00Z'}


def fix(i, t, lon=0, receipt=None):
    return event(i, 'location', receipt or t, timestamp=t, receivedAt=receipt or t,
                 latitude=0, longitude=lon, accuracy=5, speed=10, course=90)


def fuel(i, t, answered=None):
    return [event('v'+str(i), 'visit_observation', t, visitId=str(i), startedAt=t, stationId='ignored'),
            event('l'+str(i), 'visit_label', answered or t+300, visitId=str(i), label='fueled')]


class TimingTests(unittest.TestCase):
    def test_station_and_server_upload_independence(self):
        es = fuel(1, 1000) + fuel(2, 87400) + [fix('a', 173000)]
        other = copy.deepcopy(es)
        for e in other:
            e['payload']['stationId'] = 'different'
            e['serverReceivedAt'] = '2000-01-01T00:00:00Z'
        self.assertEqual(TimingFeatures(es).predict(173000), TimingFeatures(other).predict(173000))

    def test_future_outcomes_do_not_change_past_decision(self):
        prefix = fuel(1, 1000) + [fix('a', 2000)]
        self.assertEqual(TimingFeatures(prefix).predict(2000), TimingFeatures(prefix+fuel(2, 90000)).predict(2000))

    def test_history_waits_for_answer(self):
        f = TimingFeatures(fuel(1, 1000, answered=2000))
        self.assertEqual(f.predict(1999)['history_count'], 0)
        self.assertEqual(f.predict(2000)['history_count'], 1)

    def test_distance_does_not_bridge_missing_time(self):
        f = TimingFeatures([fix(1, 100), fix(2, 110, .001), fix(3, 10000, 1)])
        self.assertGreater(f.totals(110)[0], 0)
        self.assertEqual(f.totals(110), f.totals(10000))
        self.assertEqual(f.totals(109), (0, 0))

    def test_delayed_location_not_available_earlier(self):
        f = TimingFeatures([fix(1, 100, receipt=120)])
        self.assertFalse(f.predict(110)['fresh_fix'])
        self.assertTrue(f.predict(120)['fresh_fix'])

    def test_daily_alert_cap_on_wall_clock_timeline(self):
        es = fuel(1, 3600) + fuel(2, 90000) + [event('end', 'diagnostic', 500000)]
        f = TimingFeatures(es)
        f.predict = lambda t: dict(history_count=3, fresh_fix=False, moving=False,
            clock=True, elapsed_cycle=False, driving_cycle=False, clock_and_cycle=False, before_departure=False)
        result = evaluate(f)
        self.assertLessEqual(result['continuous_alerts']['clock']['alerts'], 12)
        self.assertGreater(result['wall_clock_minute_decisions'], 8000)


if __name__ == '__main__':
    unittest.main()
