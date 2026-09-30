import unittest
from priceHistory import station_histories


def row(ident, observed, source, price, method='credit'):
    return {'id': ident, 'station_id': 'A', 'provider_id': 'gasbuddy', 'fuel_type': 'premium',
        'created_at': observed, 'updated_at_source': source,
        'search_latitude_rounded': 28, 'search_longitude_rounded': -82.8,
        'all_prices': {'_payment': {'premium': {method: price}}}}


class HistoryTests(unittest.TestCase):
    def test_future_and_same_batch_rows_never_enter_history_or_replay_counts(self):
        old = row(1, '2026-09-28T10:00Z', '2026-09-28T09:00Z', 5)
        replay = row(2, '2026-09-28T11:00Z', '2026-09-28T09:00Z', 5)
        batch = '2026-09-28T12:00Z|28|-82.8|premium|credit'
        before = station_histories([old, replay], batch, ['A'])
        future = row(3, '2026-09-29T10:00Z', '2026-09-28T09:00Z', 5)
        same = row(4, '2026-09-28T12:00Z', '2026-09-28T12:00Z', 6)
        self.assertEqual(before, station_histories([old, replay, future, same], batch, ['A']))
        self.assertEqual(before['A']['reports'][0]['cache_observations'], 2)
        self.assertEqual(before['A']['independent_reports_available'], 1)

    def test_reports_keep_unchanged_updates_but_separate_payment_and_conflicts(self):
        rows = [row(1, '2026-09-28T10:00Z', '2026-09-28T09:00Z', 5),
                row(2, '2026-09-28T11:00Z', '2026-09-28T10:00Z', 5),
                row(3, '2026-09-28T11:10Z', '2026-09-28T10:30Z', 4, 'cash'),
                row(4, '2026-09-28T11:20Z', '2026-09-28T10:45Z', 4),
                row(5, '2026-09-28T11:30Z', '2026-09-28T10:45Z', 6)]
        result = station_histories(rows, '2026-09-28T12:00Z|28|-82.8|premium|credit', ['A', 'B'])
        self.assertEqual([r['price'] for r in result['A']['reports']], [5, 5])
        self.assertEqual(result['B']['reports'], [])


if __name__ == '__main__':
    unittest.main()
