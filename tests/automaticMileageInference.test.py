"""Causal and uncertainty safeguards for the offline automatic inference study."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts/driving-research'))
from automaticRefuelEvidence import infer
from inferMileageConfidence import AutomaticEvidence, decisions, stable
from mileageGapEvidence import history_segments, evidence, covered_seconds


def observation(vid, start, time=None, samples=1, station='same'):
    return dict(id='obs'+vid+str(time), kind='visit_observation', recordedAt=time or start,
                payload=dict(visitId=vid, startedAt=start, lastInsideAt=time or start,
                             samples=samples, stationId=station))


def answer(vid, time, value='fueled'):
    return dict(id='label'+vid+str(time), kind='visit_label', recordedAt=time,
                payload=dict(visitId=vid, label=value))


def history(start, end, known, index=0, count=1, activities=None):
    return dict(id='history'+str(index), kind='diagnostic', recordedAt=known,
                payload=dict(source='apple_motion_history', status='available',
                    queryStartAt=start, queryEndAt=end, chunkIndex=index, chunkCount=count,
                    activities=activities or []))


class AutomaticInferenceTests(unittest.TestCase):
    def test_repeat_stop_requires_prior_answers_not_future_answers(self):
        es = [observation('a', 1), answer('a', 2), observation('b', 100), answer('b', 101),
              observation('c', 200, 381, 4)]
        predictions, report = infer(es+[answer('c', 400, 'not_fueling')])
        self.assertEqual(len(predictions), 1)
        self.assertEqual(predictions[0]['known_at'], 381)
        self.assertEqual(report['outcomes'], {'not_fueling': 1})
        # A future answer scores failure; it cannot suppress the earlier guess.
        self.assertEqual(infer([e for e in es if e['id'] != 'labelb101']+[answer('b', 900)])[0], [])

    def test_known_negative_vetoes_repeat_station_inference(self):
        es = [observation('a', 1), answer('a', 2), observation('b', 100), answer('b', 101),
              observation('negative', 150), answer('negative', 151, 'not_fueling'),
              observation('c', 200, 381, 4)]
        self.assertEqual(infer(es)[0], [])

    def test_inferred_stops_do_not_train_more_inferred_stops(self):
        es = [observation('a', 1), answer('a', 2), observation('b', 100), answer('b', 101),
              observation('c', 200, 381, 4), observation('d', 400, 581, 4)]
        p, _ = infer(es)
        self.assertEqual([x['prior_confirmed_purchases'] for x in p], [2, 2])

    def test_unanswered_stop_reduces_confidence_not_a_fuel_label(self):
        e = AutomaticEvidence()
        e.ingest(observation('unknown', 100, 300, 4))
        self.assertEqual(e.unresolved_stops(0), 1)
        self.assertEqual(e.labels, {})
        e.ingest(answer('unknown', 310, 'not_fueling'))
        self.assertEqual(e.unresolved_stops(0), 0)

    def test_gate_abstention_is_not_success_or_confirmed_fuel(self):
        self.assertFalse(stable([100, 100]))
        self.assertFalse(stable([100, 100, 200]))
        self.assertFalse(decisions([100, 100, 100], 0, False, 0, False)['ledger_and_no_detected_gap_driving'])

    def test_motion_history_requires_all_chunks_and_uses_receipt_time(self):
        act = dict(timestamp=10, automotive=True, stationary=False, confidence=2)
        first = history(0, 100, 200, 0, 2, [act])
        self.assertEqual(history_segments([first])[0], [])
        segments, _ = history_segments([first, history(0, 100, 300, 1, 2)])
        self.assertEqual(segments, [dict(start=10, end=100, known=300, state='automotive')])

    def test_history_prefix_is_not_filled_with_a_later_activity(self):
        act = dict(timestamp=90, stationary=True, automotive=False, confidence=2)
        segments, _ = history_segments([history(0, 100, 200, activities=[act])])
        self.assertEqual(segments[0]['start'], 90)

    def test_history_claiming_a_future_query_end_is_not_used(self):
        act = dict(timestamp=90, stationary=True, automotive=False, confidence=2)
        self.assertEqual(history_segments([history(0, 100, 50, activities=[act])])[0], [])

    def test_overlapping_history_does_not_double_count_seconds(self):
        self.assertEqual(covered_seconds([(0, 40), (20, 60), (20, 60)]), 60)

    def test_gap_risk_is_not_available_before_history_returns(self):
        def checkpoint(time, meters, gap_count, gap_seconds, samples):
            return dict(id=str(time), kind='diagnostic', recordedAt=time,
                payload=dict(mileageAtReceipt=dict(epoch='one', lastSampleAt=time,
                    capturedMeters=meters, gapCount=gap_count, unmeasuredGapSeconds=gap_seconds,
                    acceptedSamples=samples, collectionBoundaryCount=0)))
        events = [checkpoint(1, 0, 0, 0, 1), checkpoint(601, 0, 1, 600, 2),
                  history(1, 601, 900, activities=[dict(timestamp=200, automotive=True,
                                                       stationary=False, confidence=2)])]
        risks, report = evidence(events)
        self.assertEqual(report['exact_gap_windows'], 1)
        self.assertEqual(risks[0]['known'], 900)
        self.assertNotIn('missing_miles', risks[0])


if __name__ == '__main__':
    unittest.main()
