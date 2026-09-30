"""Compare two archived national hours without provider calls or price correction.

Usage: python3 scripts/national-prices/comparePriceHours.py BEFORE_DIR AFTER_DIR OUTPUT
Each input contains manifest.json and archives at their original object paths.
AFTER_DIR also contains cities.json.gz to establish the campaign holdout boundary.
"""
import collections
import gzip
import hashlib
import json
from pathlib import Path
import sys

from analyzeEarlyPrices import distribution, positive, timestamp


def load_hour(root, holdout_start):
    manifest = json.loads((root / 'manifest.json').read_text())
    run, jobs = manifest['run'], manifest['jobs']
    assert run['status'] == 'complete' and len(jobs) == run['expected_batches']
    assert timestamp(run['deadline_at']) <= holdout_start, 'Reserved holdout supplied'
    stations, quotes, hashes, observed = {}, {}, {}, {}
    for job in jobs:
        assert job['status'] == 'succeeded'
        data = (root / job['object_path']).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        assert len(data) == job['archive_bytes'] and digest == job['sha256']
        snapshot = json.loads(gzip.decompress(data))
        assert snapshot['executionRegion'] == job['execution_region']
        assert [s['id'] for s in snapshot['stations']] == job['station_ids']
        assert timestamp(snapshot['startedAt']) == timestamp(job['started_at'])
        assert timestamp(snapshot['observedAt']) == timestamp(job['observed_at'])
        assert timestamp(run['slot_at']) <= timestamp(snapshot['startedAt']) <= timestamp(snapshot['observedAt']) <= timestamp(run['deadline_at'])
        hashes[job['object_path']] = digest
        for s in snapshot['stations']:
            assert s['id'] not in stations
            stations[s['id']] = s
            observed[s['id']] = timestamp(snapshot['observedAt'])
            for price in s['prices']:
                for payment in ('cash', 'credit'):
                    key = (s['id'], price['fuelProduct'], payment)
                    assert key not in quotes
                    quotes[key] = price.get(payment)
    assert len(stations) == run['expected_stations']
    assert sum(any(positive(p.get(k)) for p in s['prices'] for k in ('cash', 'credit')) for s in stations.values()) == sum(j['priced_count'] for j in jobs)
    return {'run': run, 'stations': stations, 'quotes': quotes, 'observed': observed, 'hashes': hashes,
            'attempts': sum(j['attempts'] for j in jobs)}


def compare(before, after, state_by_id):
    assert before['stations'].keys() == after['stations'].keys(), 'Inventory changed'
    assert timestamp(before['run']['slot_at']) < timestamp(after['run']['slot_at'])
    counts = collections.Counter()
    age_cohorts, missing_ages = collections.defaultdict(collections.Counter), []
    by_grade, by_state = collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
    changes, intervals = [], []
    forward_same_ids, changed_ids, gained_ids, lost_ids = set(), set(), set(), set()
    for sid in before['stations']:
        intervals.append((after['observed'][sid] - before['observed'][sid]) / 60)
    for key in sorted(before['quotes'].keys() | after['quotes'].keys()):
        sid, fuel, payment = key
        a, b = before['quotes'].get(key), after['quotes'].get(key)
        va, vb = positive(a), positive(b)
        if va and timestamp(a.get('postedTime')) is not None:
            age = (before['observed'][sid] - timestamp(a['postedTime'])) / 3600
            label = next(name for upper, name in [(0, 'future'), (1, '0-1h'), (6, '1-6h'),
                         (24, '6-24h'), (47, '24-47h'), (48, '47-48h'), (49, '48-49h'),
                         (72, '49-72h'), (float('inf'), '72h+')] if age < upper)
            cohort = age_cohorts[label]
            cohort['before'] += 1
            if not vb:
                cohort['newly_missing'] += 1
                missing_ages.append(age)
            elif b['price'] != a['price']:
                cohort['changed'] += 1
                cohort['down' if b['price'] < a['price'] else 'up'] += 1
        if va and vb:
            delta = round(b['price'] - a['price'], 6)
            category = 'price_changed' if delta else 'price_unchanged'
            counts['comparable_positive_quotes'] += 1
            ta, tb = timestamp(a.get('postedTime')), timestamp(b.get('postedTime'))
            timing = ('missing_time' if ta is None or tb is None else
                      'advanced' if tb > ta else 'backward' if tb < ta else 'same_time')
            counts[f'{category}_{timing}'] += 1
            if delta:
                changed_ids.add(sid)
                changes.append({'station_id': sid, 'state': state_by_id[sid], 'fuel': fuel, 'payment': payment,
                                'before': a['price'], 'after': b['price'], 'delta': delta,
                                'previous_report_age_hours': round((before['observed'][sid] - ta) / 3600, 6) if ta is not None else None,
                                'before_posted_time': a.get('postedTime'), 'after_posted_time': b.get('postedTime'),
                                'timestamp_direction': timing})
            elif timing == 'advanced':
                forward_same_ids.add(sid)
        elif vb:
            category = 'newly_available_quotes'
            gained_ids.add(sid)
        elif va:
            category = 'newly_missing_quotes'
            lost_ids.add(sid)
        else:
            category = 'unpriced_both'
        counts[category] += 1
        by_grade[f'{fuel}/{payment}'][category] += 1
        by_state[state_by_id[sid]][category] += 1
    positive_before = sum(positive(q) for q in before['quotes'].values())
    positive_after = sum(positive(q) for q in after['quotes'].values())
    assert positive_after - positive_before == counts['newly_available_quotes'] - counts['newly_missing_quotes']
    assert counts['price_changed'] + counts['price_unchanged'] == counts['comparable_positive_quotes']
    priced = lambda hour: {sid for sid, s in hour['stations'].items() if any(positive(p.get(k)) for p in s['prices'] for k in ('cash', 'credit'))}
    priced_before, priced_after = priced(before), priced(after)
    return {'before_run': before['run']['id'], 'after_run': after['run']['id'],
            'before_slot': before['run']['slot_at'], 'after_slot': after['run']['slot_at'],
            'stations_compared': len(before['stations']), 'station_interval_minutes': distribution(intervals),
            'positive_quotes_before': positive_before, 'positive_quotes_after': positive_after,
            'counts': dict(counts), 'stations_with_price_changes': len(changed_ids),
            'stations_with_unchanged_price_refreshes': len(forward_same_ids),
            'stations_with_any_new_quote': len(gained_ids), 'stations_with_any_lost_quote': len(lost_ids),
            'stations_becoming_priced': len(priced_after - priced_before),
            'stations_losing_all_prices': len(priced_before - priced_after),
            'upward_changes': sum(c['delta'] > 0 for c in changes), 'downward_changes': sum(c['delta'] < 0 for c in changes),
            'absolute_price_change': distribution([abs(c['delta']) for c in changes]),
            'regular_credit_absolute_change': distribution([abs(c['delta']) for c in changes if c['fuel'] == 'regular_gas' and c['payment'] == 'credit']),
            'changed_quote_previous_age_hours': distribution([c['previous_report_age_hours'] for c in changes if c['previous_report_age_hours'] is not None]),
            'previous_age_cohorts': {k: dict(v) for k, v in sorted(age_cohorts.items())},
            'newly_missing_previous_age_hours': distribution(missing_ages),
            'by_grade_payment': {k: dict(v) for k, v in sorted(by_grade.items())},
            'by_state': {k: dict(v) for k, v in sorted(by_state.items())},
            'changes': sorted(changes, key=lambda c: -abs(c['delta'])),
            'archive_hashes_before': before['hashes'], 'archive_hashes_after': after['hashes'],
            'attempts_before': before['attempts'], 'attempts_after': after['attempts'],
            'limitations': 'Matched station ID, fuel and payment. Snapshot differences are provider updates, not verified corrections or pump truth. Cash/credit and fuel grades can share a reporting event. Unpriced-both includes absent grades and null/zero prices. No model fitted.'}


if __name__ == '__main__':
    before_root, after_root = map(Path, sys.argv[1:3])
    city = json.loads(gzip.decompress((after_root / 'cities.json.gz').read_bytes()))
    holdout = timestamp(city['health']['ends_at']) - 2 * 86400
    catalog_path = Path(__file__).resolve().parents[2] / 'docs/research/2026-09-30-national-prices/verified-catalog.json.gz'
    catalog = json.loads(gzip.decompress(catalog_path.read_bytes()))
    states = {sid: r['code'] for r in catalog['regions'] for sid in r['ids']}
    result = compare(load_hour(before_root, holdout), load_hour(after_root, holdout), states)
    with open(sys.argv[3], 'x') as out:
        json.dump(result, out, indent=2, allow_nan=False)
        out.write('\n')
    print(json.dumps({k: result[k] for k in ('before_run', 'after_run', 'counts', 'stations_with_price_changes')}))
