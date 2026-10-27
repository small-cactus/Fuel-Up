"""Causality and outcome guards for the exploratory route-window audit."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts/driving-research'))
from auditRouteWindow import RouteWindow, inside_bracket, match, strict_score


def fix(time, longitude, course=90):
    return dict(id='fix'+str(time), kind='location', recordedAt=time,
                payload=dict(timestamp=time, latitude=30, longitude=longitude,
                             course=course, speed=10, accuracy=5))


def visit(vid, time, station='a'):
    return dict(id='visit'+vid, kind='visit_observation', recordedAt=time,
                payload=dict(visitId=vid, stationId=station, startedAt=time, lastInsideAt=time))


def label(vid, time, value='fueled'):
    return dict(id='label'+vid, kind='visit_label', recordedAt=time,
                payload=dict(visitId=vid, label=value))


def trip():
    return [fix(100, -80.002), fix(130, -80.001), fix(160, -80),
            visit('first', 400), label('first', 500),
            fix(1000, -80.002), fix(1030, -80.001), fix(1060, -80)]


class RouteWindowTests(unittest.TestCase):
    def test_unanswered_and_missing_outcomes_count_as_wrong(self):
        c = dict(predictions=9, correct_purchase_station=4, unanswered_encounter=3,
                 no_observed_encounter=1, end_censored=1)
        self.assertEqual(strict_score(c), dict(correct=4, wrong=5, correct_prediction_rate=4/9))
        self.assertIsNone(strict_score({})['correct_prediction_rate'])

    def test_tighter_sequence_requires_every_point_close(self):
        es = trip()
        # About 190m offset only at the first point: endpoint-only gating would leak through.
        es[5]['payload']['longitude'] -= .002
        pred = RouteWindow(es).predict(1060)
        self.assertEqual(pred['sequence'], 'a')
        self.assertIsNone(pred['sequence_150m'])
        self.assertIsNone(pred['sequence_100m'])

    def test_extra_gates_cannot_invent_prior_purchases(self):
        pred = RouteWindow(trip()).predict(1060)
        self.assertEqual(pred['sequence_100m'], 'a')
        self.assertIsNone(pred['sequence_two_prior'])
        self.assertIsNone(pred['sequence_stable_cycles'])

    def test_bracket_needs_three_cycles_and_has_upper_bound(self):
        s = dict(known_mileage_cycles=3, recent_cycle_min_miles=100,
                 recent_cycle_max_miles=150, observed_miles_since_fill=90)
        self.assertTrue(inside_bracket(s))
        self.assertFalse(inside_bracket({**s, 'known_mileage_cycles': 2}))
        self.assertFalse(inside_bracket({**s, 'observed_miles_since_fill': 161}))

    def test_future_answer_does_not_train_current_prediction(self):
        es = [e for e in trip() if e['kind'] != 'visit_label']
        engine = RouteWindow(es+[label('first', 1200)])
        self.assertIsNone(engine.predict(1060)['route'])
        self.assertIsNone(engine.predict(1060)['habit'])

    def test_repeat_ordered_route_predicts_known_station(self):
        pred = RouteWindow(trip()).predict(1060)
        self.assertEqual(pred['habit'], 'a')
        self.assertEqual(pred['route'], 'a')
        self.assertEqual(pred['sequence'], 'a')

    def test_one_point_or_stale_history_cannot_be_a_sequence(self):
        es = [e for e in trip() if e['id'] not in ('fix1000', 'fix1030')]
        pred = RouteWindow(es).predict(1060)
        self.assertEqual(pred['route'], 'a')
        self.assertIsNone(pred['sequence'])
        self.assertIsNone(RouteWindow(es).predict(1300)['route'])

    def test_heading_reversal_is_not_same_approach(self):
        self.assertIsNone(match(fix(1, -80, 90)['payload'], fix(2, -80, 270)['payload']))
        self.assertIsNotNone(match(fix(1, -80, 359)['payload'], fix(2, -80, 1)['payload']))

    def test_current_answer_does_not_leak_into_route_or_unknown_outcome(self):
        es = trip()+[visit('second', 1300, 'b')]
        engine = RouteWindow(es)
        self.assertEqual(engine.predict(1060)['route'], 'a')
        self.assertEqual(engine.outcome(1060, 'a', 3000)[0], 'unanswered_encounter')
        engine = RouteWindow(es+[label('second', 1400)])
        self.assertEqual(engine.predict(1060)['route'], 'a')
        self.assertEqual(engine.outcome(1060, 'a', 3000)[0], 'wrong_purchase_station')

    def test_absent_encounter_and_end_censoring_are_not_confirmed_negatives(self):
        engine = RouteWindow(trip())
        self.assertEqual(engine.outcome(1060, 'a', 3000)[0], 'no_observed_encounter')
        self.assertEqual(engine.outcome(1060, 'a', 1500)[0], 'end_censored')

    def test_nonpurchase_outcome_is_not_a_successful_station_prediction(self):
        engine = RouteWindow(trip()+[visit('second', 1300), label('second', 1400, 'not_fueling')])
        self.assertEqual(engine.outcome(1060, 'a', 3000)[0], 'explicit_nonpurchase')

    def test_opposite_order_cannot_match_sequence_even_with_matching_headings(self):
        es = [fix(100, -80.008), fix(130, -80.004), fix(160, -80),
              visit('first', 400), label('first', 500),
              fix(1000, -80), fix(1030, -80.004), fix(1060, -80.008)]
        pred = RouteWindow(es).predict(1060)
        self.assertEqual(pred['route'], 'a')
        self.assertIsNone(pred['sequence'])


if __name__ == '__main__':
    unittest.main()
