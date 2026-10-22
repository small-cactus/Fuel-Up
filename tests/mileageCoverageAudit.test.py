"""Integrity gates for the offline audit; no database or participant fixtures."""
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts/driving-research'))
from auditMileageCoverage import ledger_interval, load, account_report


def visit(vid, time, meters, **extra):
    return dict(id=vid, kind='visit_observation', recordedAt=time, payload=dict(
        visitId=vid, startedAt=time-5, mileageAtReceipt=dict(epoch='one',
        capturedMeters=meters, gapCount=0, unmeasuredGapSeconds=0,
        acceptedSamples=10, collectionBoundaryCount=0, completeOdometer=False, **extra)))


class MileageAuditTests(unittest.TestCase):
    def test_reset_cannot_be_counted_as_distance(self):
        a, b = visit('a', 10, 0), visit('b', 20, 2000)
        b['payload']['mileageAtReceipt']['epoch'] = 'new'
        self.assertEqual(ledger_interval(a, b)['status'], 'epoch_changed')

    def test_missing_counter_is_not_a_zero_distance_cycle(self):
        a, b = visit('a', 10, 0), visit('b', 20, 2000)
        del a['payload']['mileageAtReceipt']
        self.assertEqual(ledger_interval(a, b)['status'], 'missing_endpoint')

    def test_boundary_stays_visible_even_without_gap_seconds(self):
        a, b = visit('a', 10, 0), visit('b', 20, 1609.344)
        b['payload']['mileageAtReceipt']['collectionBoundaryCount'] = 1
        result = ledger_interval(a, b)
        self.assertEqual(result['collection_boundaries'], 1)
        self.assertEqual(result['captured_miles'], 1)
        self.assertFalse(result['complete_odometer'])

    def test_counter_regression_rejected(self):
        self.assertEqual(ledger_interval(visit('a', 10, 2000), visit('b', 20, 1000))['status'],
                         'missing_or_decreasing_counter')

    def test_latest_answer_replaces_old_answer_without_double_count(self):
        v = visit('a', 10, 0)
        def label(key, time, answer):
            return dict(id=key, kind='visit_label', recordedAt=time,
                        payload=dict(visitId='a', label=answer, labeledAt=time))
        r = account_report([v, label('l1', 20, 'fueled'), label('l2', 30, 'not_fueling')], 1)
        self.assertEqual(r['confirmed_purchases'], 0)
        self.assertEqual(r['labels'], {'not_fueling': 1})

    def test_late_upload_does_not_enter_frozen_dataset(self):
        with tempfile.TemporaryDirectory() as d:
            row = dict(participant_id='private', id='a', received_at='2026-10-23T00:00:00Z')
            pathlib.Path(d, 'visits.json').write_text(json.dumps(dict(ok=True, data=dict(rows=[row]))))
            with self.assertRaisesRegex(ValueError, 'outside'):
                load(pathlib.Path(d), 0)

    def test_future_label_cannot_supply_ledger_forecast_training(self):
        visits = [visit(str(i), 100 + i*100, i*1609.344) for i in range(5)]
        labels = [dict(id='label'+str(i), kind='visit_label', recordedAt=101+i*100,
                       payload=dict(visitId=str(i), label='fueled')) for i in range(5)]
        self.assertEqual(len(account_report(visits+labels, 1)['ledger_last_three_median_forecasts']), 1)
        labels[1]['recordedAt'] = 1000
        self.assertEqual(account_report(visits+labels, 1)['ledger_last_three_median_forecasts'], [])


if __name__ == '__main__':
    unittest.main()
