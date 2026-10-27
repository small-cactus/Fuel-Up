"""Leakage and strict scoring checks for offline prediction model evaluation."""
import pathlib
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]/'scripts/driving-research'))
from trainRouteModels import TRAIN_END, TEST_START, partition, as_of_truth, alerts, choose_threshold
from trainMileageModels import examples


class ResearchMLTests(unittest.TestCase):
    def test_outcome_horizon_is_embargoed_at_both_boundaries(self):
        self.assertEqual(partition(TRAIN_END-901), 'train')
        self.assertEqual(partition(TRAIN_END-899), 'embargo')
        self.assertEqual(partition(TRAIN_END), 'validation')
        self.assertEqual(partition(TEST_START-899), 'embargo')
        self.assertEqual(partition(TEST_START), 'test')

    def test_later_answer_cannot_label_training_example(self):
        engine = SimpleNamespace(timing=SimpleNamespace(labels=[(1, 'a', 'not_fueling'), (20, 'a', 'fueled')]))
        self.assertEqual(as_of_truth(engine, 10), {'a': 'not_fueling'})
        self.assertEqual(as_of_truth(engine, 30), {'a': 'fueled'})

    def test_cooldown_and_all_unconfirmed_outcomes_are_failures(self):
        rows = [dict(account=1, time=t, outcome=o, visit='visit', station='s', arrival=t+300)
                for t, o in [(0, 'correct_purchase_station'), (60, 'correct_purchase_station'),
                             (1800, 'unanswered_encounter'), (3600, 'end_censored')]]
        result = alerts(rows, [1, 1, 1, 1])
        self.assertEqual((result['predictions'], result['correct'], result['wrong']), (3, 1, 2))
        self.assertEqual(result['distinct_purchases_caught'], 1)

    def test_abstention_is_not_a_perfect_model(self):
        self.assertIsNone(alerts([], [])['correct_prediction_rate'])
        self.assertEqual(choose_threshold([], []), (None, None))

    def test_mileage_training_features_exclude_target_and_delayed_answers(self):
        events = []
        for i, miles in enumerate([0, 10, 30, 60, 1060]):
            time = 100+i*100
            events.append(dict(id='v'+str(i), kind='visit_observation', recordedAt=time,
                payload=dict(visitId=str(i), startedAt=time, mileageAtReceipt=dict(epoch='one',
                    capturedMeters=miles*1609.344, gapCount=0, unmeasuredGapSeconds=0,
                    collectionBoundaryCount=0, acceptedSamples=i+1))))
            events.append(dict(id='l'+str(i), kind='visit_label', recordedAt=time+1,
                               payload=dict(visitId=str(i), label='fueled')))
        result = examples(events, 1)
        self.assertEqual(len(result), 1)
        for actual, expected in zip(result[0]['history_miles'], [10, 20, 30], strict=True):
            self.assertAlmostEqual(actual, expected)
        self.assertAlmostEqual(result[0]['y'], 1000)
        self.assertNotIn(1000, result[0]['x'])
        # An answer arriving after the forecast cannot complete its prior cycle.
        events[3]['recordedAt'] = 1000
        self.assertEqual(examples(events, 1), [])


if __name__ == '__main__':
    unittest.main()
