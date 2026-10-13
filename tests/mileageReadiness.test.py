"""Mileage-only causality, invariance, cold start, and replay checks."""
import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/driving-research'))
from mileageReadiness import MileageReadiness, KM_PER_MILE, ready
from timingFeatures import TimingFeatures
from backtestMileageOnly import replay, cycle_forecasts


class CapturedTravel:
    def __init__(self, cycles, since=0):
        self.fills = [dict(id='0', arrival=0)]
        self.miles = {0: 0}
        total = 0
        for index, interval in enumerate(cycles, 1):
            total += interval
            self.fills.append(dict(id=str(index), arrival=index))
            self.miles[index] = total
        self.total = total + since

    def history(self, cutoff):
        return self.fills

    def totals(self, cutoff):
        return self.miles.get(cutoff, self.total) * KM_PER_MILE, 0


def event(kind, t, **payload):
    return dict(id=f'{kind}-{t}', kind=kind, recordedAt=t, payload=payload)


def fix(t, longitude):
    return event('location', t, timestamp=t, receivedAt=t, latitude=0,
                 longitude=longitude, accuracy=5, speed=10, quality='accepted')


def fill(t, label_at, identifier):
    return [event('visit_observation', t, visitId=identifier, startedAt=t),
            event('visit_label', label_at, visitId=identifier, label='fueled', labeledAt=label_at)]


class MileageTests(unittest.TestCase):
    def test_learns_first_interval_after_two_fills(self):
        s = MileageReadiness(CapturedTravel([100], 30)).snapshot(1000)
        self.assertAlmostEqual(s['typical_observed_fill_miles'], 100)
        self.assertAlmostEqual(s['predicted_miles_remaining'], 70)

    def test_elapsed_time_does_not_change_forecast(self):
        model = MileageReadiness(CapturedTravel([100, 120], 80))
        self.assertEqual(model.snapshot(1000), model.snapshot(1000000))

    def test_accumulated_distance_reduces_remaining_one_for_one(self):
        before = MileageReadiness(CapturedTravel([120], 30)).snapshot(1000)
        after = MileageReadiness(CapturedTravel([120], 45)).snapshot(1000)
        self.assertAlmostEqual(before['predicted_miles_remaining'] - after['predicted_miles_remaining'], 15)

    def test_single_fill_cannot_predict(self):
        s = MileageReadiness(CapturedTravel([], 1000)).snapshot(10000)
        self.assertTrue(math.isnan(s['predicted_miles_remaining']))
        self.assertFalse(ready(s))

    def test_no_travel_is_missing_not_zero_range(self):
        self.assertFalse(ready(MileageReadiness(CapturedTravel([0], 50)).snapshot(1000)))

    def test_last_three_intervals_adapt(self):
        s = MileageReadiness(CapturedTravel([500, 90, 100, 110], 50)).snapshot(1000)
        self.assertAlmostEqual(s['typical_observed_fill_miles'], 100)
        self.assertAlmostEqual(MileageReadiness(CapturedTravel([100, 150])).snapshot(1000, rule='last_interval')['typical_observed_fill_miles'], 150)

    def test_requested_warmup_cannot_be_overridden(self):
        s = MileageReadiness(CapturedTravel([100], 500)).snapshot(1000, minimum_cycles=3)
        self.assertFalse(ready(s))

    def test_alert_boundary_and_overdue(self):
        self.assertTrue(ready({'predicted_miles_remaining': 10}, 10))
        self.assertFalse(ready({'predicted_miles_remaining': 10.01}, 10))
        self.assertTrue(ready({'predicted_miles_remaining': -5}, 10))

    def test_future_answer_cannot_reset_distance(self):
        events = [fix(1, 0), fix(61, .005)] + fill(2, 3, 'a') + fill(62, 200, 'b')
        early = MileageReadiness(TimingFeatures(events)).snapshot(100)
        later = MileageReadiness(TimingFeatures(events)).snapshot(201)
        self.assertEqual(early['known_confirmed_fills'], 1)
        self.assertEqual(later['known_confirmed_fills'], 2)
        self.assertGreater(early['observed_miles_since_fill'], later['observed_miles_since_fill'])

    def test_future_fix_cannot_change_forecast(self):
        events = [fix(1, 0), fix(61, .005), fix(121, .01)] + fill(2, 3, 'a') + fill(62, 63, 'b')
        a = MileageReadiness(TimingFeatures(events)).snapshot(125)
        b = MileageReadiness(TimingFeatures(events + [fix(181, .02)])).snapshot(125)
        self.assertEqual(a, b)

    def test_tracking_gap_is_not_bridged(self):
        timing = TimingFeatures([fix(1, 0), fix(601, .02)])
        self.assertEqual(timing.totals(602)[0], 0)

    def test_replay_only_alerts_once_per_known_fill(self):
        events = [fix(t, t * .00001) for t in range(1, 602, 60)] + fill(2, 3, 'a') + fill(122, 123, 'b')
        alerts = replay(TimingFeatures(events), lead_miles=.1)
        self.assertEqual(len(alerts), 1)
        self.assertIsNone(alerts[0]['within_evaluation_distance_window'])

    def test_forecast_requires_prior_answer_before_next_fill(self):
        events = [fix(t, t * .00001) for t in range(1, 602, 60)]
        events += fill(2, 3, 'a') + fill(122, 400, 'b') + fill(242, 243, 'c')
        self.assertEqual(cycle_forecasts(TimingFeatures(events), 'last_interval'), [])


if __name__ == '__main__':
    unittest.main()
