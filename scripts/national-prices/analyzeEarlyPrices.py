"""Offline descriptive analysis; reads archived observations, never calls provider.

Usage: python3 scripts/national-prices/analyzeEarlyPrices.py INPUT_DIR OUTPUT_JSON
INPUT_DIR contains manifest.json, cities.json.gz and national run Storage paths.
Percentiles use nearest rank. Prices are provider reports, not pump truth.
"""
import collections
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys


def timestamp(value):
    try:
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError, AttributeError):
        return None


def distribution(values):
    values = sorted(values)
    if not values:
        return {'n': 0}
    return {'n': len(values), **{
        label: round(values[max(0, math.ceil(len(values) * p) - 1)], 6)
        for label, p in [('min', 0), ('p10', .1), ('p50', .5), ('p90', .9), ('p95', .95), ('max', 1)]}}


def positive(quote):
    return quote is not None and isinstance(quote.get('price'), (int, float)) and quote['price'] > 0


def quote_age(quote, observed):
    reported = timestamp(quote.get('postedTime'))
    return (observed - reported) / 3600 if reported is not None else None


def contemporaneous(a, b, observed):
    ages = [quote_age(q, observed) for q in (a, b)]
    return all(x is not None and 0 <= x <= 24 for x in ages) and abs(ages[0] - ages[1]) <= 1


def analyze(root):
    manifest = json.loads((root / 'manifest.json').read_text())
    run, jobs = manifest['run'], manifest['jobs']
    assert run['status'] == 'complete' and len(jobs) == run['expected_batches']
    city_bytes = (root / 'cities.json.gz').read_bytes()
    city = json.loads(gzip.decompress(city_bytes))
    holdout_start = timestamp(city['health']['ends_at']) - 2 * 86400
    assert timestamp(run['deadline_at']) <= holdout_start, 'Reserved national holdout supplied'
    catalog_path = Path(__file__).resolve().parents[2] / 'docs/research/2026-09-30-national-prices/verified-catalog.json.gz'
    catalog = json.loads(gzip.decompress(catalog_path.read_bytes()))
    states = {sid: region['code'] for region in catalog['regions'] for sid in region['ids']}
    assert len(states) == sum(len(r['ids']) for r in catalog['regions'])
    seen, all_quotes, regular, premiums, cash_pairs = set(), [], [], [], []
    grades = collections.Counter()
    station_priced = 0
    for job in jobs:
        assert job['status'] == 'succeeded'
        data = (root / job['object_path']).read_bytes()
        assert len(data) == job['archive_bytes']
        assert hashlib.sha256(data).hexdigest() == job['sha256']
        snapshot = json.loads(gzip.decompress(data))
        assert snapshot['executionRegion'] == job['execution_region']
        assert [s['id'] for s in snapshot['stations']] == job['station_ids']
        observed = timestamp(snapshot['observedAt'])
        for station in snapshot['stations']:
            sid = station['id']
            assert sid not in seen and sid in states
            seen.add(sid)
            prices = {p['fuelProduct']: p for p in station['prices']}
            assert len(prices) == len(station['prices'])
            station_priced += any(positive(p.get(k)) for p in prices.values() for k in ('cash', 'credit'))
            for fuel, p in prices.items():
                if any(positive(p.get(k)) for k in ('cash', 'credit')):
                    grades[fuel] += 1
                for payment in ('cash', 'credit'):
                    q = p.get(payment)
                    if positive(q):
                        all_quotes.append({'age': quote_age(q, observed), 'price': q['price']})
            reg = prices.get('regular_gas', {})
            payment = 'credit' if positive(reg.get('credit')) else 'cash'
            q = reg.get(payment)
            if positive(q):
                regular.append({'id': sid, 'state': states[sid], 'payment': payment,
                                'price': q['price'], 'age': quote_age(q, observed)})
            cash, credit = reg.get('cash'), reg.get('credit')
            if positive(cash) and positive(credit) and contemporaneous(cash, credit, observed):
                cash_pairs.append({'id': sid, 'state': states[sid], 'discount': round(credit['price'] - cash['price'], 6)})
            prem = prices.get('premium_gas', {}).get('credit')
            if positive(credit) and positive(prem) and contemporaneous(credit, prem, observed):
                premiums.append(round(prem['price'] - credit['price'], 6))
    assert len(seen) == run['expected_stations']
    assert station_priced == sum(j['priced_count'] for j in jobs)
    ages = [r['age'] for r in regular if r['age'] is not None and r['age'] >= 0]
    recent = [r for r in regular if r['age'] is not None and 0 <= r['age'] <= 24 and r['payment'] == 'credit']
    by_state = collections.defaultdict(list)
    for r in recent:
        by_state[r['state']].append(r['price'])
    discounts = [p['discount'] for p in cash_pairs]
    national = {'stations': len(seen), 'priced_stations': station_priced, 'unpriced_stations': len(seen) - station_priced,
                'positive_quotes_all_grades_payments': len(all_quotes), 'stations_by_priced_grade': dict(grades),
                'regular_stations': len(regular), 'regular_cash_fallback': sum(r['payment'] == 'cash' for r in regular),
                'regular_age_hours': distribution(ages),
                'regular_missing_time': sum(r['age'] is None for r in regular),
                'regular_future_time': sum(r['age'] is not None and r['age'] < 0 for r in regular),
                'regular_age_counts': {str(h): sum(a <= h for a in ages) for h in (1, 6, 24, 72, 168)},
                'fresh_regular_credit_prices': distribution([r['price'] for r in recent]),
                'state_fresh_regular_credit': {s: distribution(v) for s, v in sorted(by_state.items())},
                'cash_comparison': {'pairs': len(discounts), 'cheaper': sum(d > 0 for d in discounts),
                                    'equal': sum(d == 0 for d in discounts), 'more_expensive': sum(d < 0 for d in discounts),
                                    'discounts_where_cheaper': distribution([d for d in discounts if d > 0]),
                                    'at_least_10_cents': sum(d >= .10 for d in discounts)},
                'premium_credit_surcharge': distribution(premiums),
                'premium_cheaper_than_regular': sum(p < 0 for p in premiums)}

    snapshots = sorted(city['snapshots'], key=lambda s: s['observed_at'])
    # Preserve the final two campaign days: descriptive early analysis refuses them.
    assert all(timestamp(s['observed_at']) < holdout_start for s in snapshots), 'Reserved holdout data supplied'
    histories, city_snapshots = collections.defaultdict(list), collections.defaultdict(list)
    for snap in snapshots:
        city_snapshots[snap['city_id']].append(snap)
        for station in snap['payload']['stations']:
            for p in station['prices']:
                for payment in ('cash', 'credit'):
                    q = p.get(payment)
                    key = (snap['city_id'], station['stationId'], p['fuel'], payment)
                    histories[key].append({'price': q['price'] if positive(q) else None,
                                           'reported': q.get('sourceUpdatedAt') if q else None,
                                           'observed': snap['observed_at'], 'name': station['name']})
    pairs = refreshed_same = refreshed_changed = backwards = changed_no_new_time = 0
    changes, timestamp_lags = [], []
    for key, history in histories.items():
        for before, after in zip(history, history[1:]):
            if before['price'] is None or after['price'] is None:
                continue
            pairs += 1
            a, b = timestamp(before['reported']), timestamp(after['reported'])
            delta = round(after['price'] - before['price'], 6)
            advanced = a is not None and b is not None and b > a
            if advanced:
                refreshed_changed += delta != 0
                refreshed_same += delta == 0
            if a is not None and b is not None and b < a:
                backwards += 1
            if delta:
                changed_no_new_time += not advanced
                changes.append({'city': key[0], 'id': key[1], 'fuel': key[2], 'payment': key[3],
                                'name': before['name'], 'before': before['price'], 'after': after['price'],
                                'delta': delta, 'first_observed': before['observed'], 'next_observed': after['observed'],
                                'previous_report_age_hours': (timestamp(before['observed']) - a) / 3600 if a else None,
                                'report_timestamp_advanced': advanced})
            if b is not None:
                timestamp_lags.append((timestamp(after['observed']) - b) / 3600)

    # Fixed common candidates, one fuel/payment, previous cheapest vs next observed cheapest.
    # This is observed ranking instability, not verified realized consumer regret.
    decisions, latest_spreads = [], []
    def candidates(snap, fuel, payment):
        return {s['stationId']: (p[payment]['price'], s['name']) for s in snap['payload']['stations']
                for p in s['prices'] if p['fuel'] == fuel and positive(p.get(payment))}
    for city_id, snaps in city_snapshots.items():
        latest = candidates(snaps[-1], 'regular', 'credit')
        if len(latest) >= 5:
            d = distribution([v[0] for v in latest.values()])
            latest_spreads.append({'city': city_id, **d, 'p90_minus_p10': round(d['p90'] - d['p10'], 6)})
        for before, after in zip(snaps, snaps[1:]):
            for fuel in ('regular', 'midgrade', 'premium', 'diesel', 'e85'):
                for payment in ('cash', 'credit'):
                    a, b = candidates(before, fuel, payment), candidates(after, fuel, payment)
                    common = a.keys() & b.keys()
                    if len(common) < 5:
                        continue
                    selected = min(common, key=lambda sid: (a[sid][0], sid))
                    best = min(common, key=lambda sid: (b[sid][0], sid))
                    winners = [sid for sid in common if a[sid][0] == a[selected][0]]
                    regrets = [round(b[sid][0] - b[best][0], 6) for sid in winners]
                    decisions.append({'city': city_id, 'fuel': fuel, 'payment': payment, 'candidates': len(common),
                                      'observed_at': after['observed_at'], 'id': selected, 'name': a[selected][1],
                                      'before': a[selected][0], 'after': b[selected][0], 'new_best': b[best][0],
                                      'new_best_name': b[best][1], 'regret': round(b[selected][0] - b[best][0], 6),
                                      'initial_ties': len(winners), 'best_tie_regret': min(regrets), 'worst_tie_regret': max(regrets)})
    city_report = {'cutoff': city['exportCutoff'], 'snapshots': len(snapshots), 'cities': len(city_snapshots),
                   'station_observations': sum(len(s['payload']['stations']) for s in snapshots),
                   'unique_stations': len({k[1] for k in histories}),
                   'comparable_quote_pairs': pairs, 'price_changes': len(changes),
                   'stations_with_changes': len({c['id'] for c in changes}),
                   'timestamp_advanced_same_price': refreshed_same, 'timestamp_advanced_changed_price': refreshed_changed,
                   'timestamp_moved_backward': backwards, 'price_changed_without_newer_timestamp': changed_no_new_time,
                   'price_change_absolute': distribution([abs(c['delta']) for c in changes]),
                   'changes': sorted(changes, key=lambda c: -abs(c['delta'])),
                   'regular_credit_city_spreads': sorted(latest_spreads, key=lambda s: -s['p90_minus_p10']),
                   'ranking_comparisons': len(decisions), 'ranking_losses': sum(d['regret'] > 0 for d in decisions),
                   'ranking_regret': distribution([d['regret'] for d in decisions]),
                   'ranking_loss_cases': sorted([d for d in decisions if d['regret'] > 0], key=lambda d: -d['regret']),
                   'ranking_losses_all_tie_choices': sum(d['best_tie_regret'] > 0 for d in decisions)}
    return {'national_run_id': run['id'], 'national_slot': run['slot_at'],
            'city_export_sha256': hashlib.sha256(city_bytes).hexdigest(),
            'national_archive_hashes': {j['object_path']: j['sha256'] for j in jobs},
            'national': national, 'cities': city_report,
            'method': {'percentiles': 'nearest rank', 'fresh': '0-24 hours since provider report at collection',
                       'cash_and_grade_pairs': 'Both reports 0-24 hours old; report timestamps within one hour',
                       'ranking': 'Adjacent city snapshots; same fuel/payment; >=5 common stations; cheapest, station-ID tie break',
                       'limitations': 'Provider observations, not pump truth. City sample is selected, not representative. One national snapshot. No model fitted. No final-two-day holdout read.'}}


if __name__ == '__main__':
    result = analyze(Path(sys.argv[1]))
    with open(sys.argv[2], 'x') as f:
        json.dump(result, f, indent=2, allow_nan=False)
        f.write('\n')
    print(json.dumps({k: result[k] for k in ('national_run_id', 'national_slot')}))
