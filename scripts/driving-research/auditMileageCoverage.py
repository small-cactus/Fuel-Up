"""Audit a protected, frozen research export; emit aggregate evidence only.

Input: visits.json and locations-DD.json, each containing query data.rows.
Run: python3 scripts/driving-research/auditMileageCoverage.py PRIVATE_DIR OUTPUT CUTOFF_ISO
No participant, visit, station, installation, coordinate, or route is exported.
This is an offline measurement tool, not an alert policy.
"""
import collections
import datetime
import hashlib
import json
import statistics
import sys
from pathlib import Path

from backtestAnticipation import available, valid_fix
from backtestMileageOnly import replay, distance_between
from timingFeatures import TimingFeatures

METERS_PER_MILE = 1609.344


def epoch(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def summarize(values):
    return dict(n=len(values), minimum=min(values), median=statistics.median(values),
                maximum=max(values)) if values else dict(n=0)


def ledger_interval(start, end):
    """Counters belong to event receipt, never a backdated sensor/arrival time."""
    a = start['payload'].get('mileageAtReceipt')
    b = end['payload'].get('mileageAtReceipt')
    if not a or not b:
        return dict(status='missing_endpoint')
    if not a.get('epoch') or a['epoch'] != b.get('epoch'):
        return dict(status='epoch_changed')
    keys = ('capturedMeters', 'unmeasuredGapSeconds', 'gapCount',
            'collectionBoundaryCount', 'acceptedSamples')
    if any(k not in a or k not in b or b[k] < a[k] for k in keys):
        return dict(status='missing_or_decreasing_counter')
    return dict(status='comparable_receipt_endpoints',
                captured_miles=(b['capturedMeters'] - a['capturedMeters']) / METERS_PER_MILE,
                gap_hours=(b['unmeasuredGapSeconds'] - a['unmeasuredGapSeconds']) / 3600,
                gap_count=b['gapCount'] - a['gapCount'],
                collection_boundaries=b['collectionBoundaryCount'] - a['collectionBoundaryCount'],
                accepted_samples=b['acceptedSamples'] - a['acceptedSamples'],
                complete_odometer=False)


def load(base, received_before):
    files = [base / 'visits.json'] + sorted(base.glob('locations-*.json'))
    groups = collections.defaultdict(list)
    seen = set()
    for path in files:
        result = json.loads(path.read_text())
        if not result['ok']:
            raise ValueError(f'Failed source export: {path.name}')
        for row in result['data']['rows']:
            if epoch(row['received_at']) >= received_before:
                raise ValueError('Row lies outside the frozen upload cutoff')
            key = (row['participant_id'], row['id'])
            if key in seen:
                raise ValueError('Overlapping export rows')
            seen.add(key)
            event = dict(row.get('event') or dict(
                id=row['id'], kind=row['kind'], recordedAt=epoch(row['recorded_at']),
                payload=row['payload']))
            if isinstance(event['payload'], str):
                event['payload'] = json.loads(event['payload'])
            event['serverReceivedAt'] = row['received_at']
            groups[row['participant_id']].append(event)
    return sorted(groups.values(), key=len, reverse=True), files


def account_report(events, account):
    timing = TimingFeatures(events)
    observations = {}
    labels = {}
    for e in sorted(events, key=lambda e: (available(e), e['id'])):
        p = e['payload']
        if e['kind'] == 'visit_observation':
            observations.setdefault(p['visitId'], e)
        elif e['kind'] == 'visit_label':
            labels[p['visitId']] = e
    fuels = sorted((e for vid, e in observations.items()
                    if labels.get(vid, {}).get('payload', {}).get('label') == 'fueled'),
                   key=lambda e: e['payload']['startedAt'])
    cycles = []
    forecasts = []
    for i, (a, b) in enumerate(zip(fuels, fuels[1:])):
        start, end = a['payload']['startedAt'], b['payload']['startedAt']
        ledger = ledger_interval(a, b)
        ledger['legacy_miles_between_receipts'] = distance_between(timing, a['recordedAt'], b['recordedAt'])
        cycles.append(dict(cycle=i + 1,
                           legacy_captured_miles=distance_between(timing, start, end), ledger=ledger,
                           unanswered_observed_visits_between=sum(
                               start < e['payload']['startedAt'] < end and vid not in labels
                               for vid, e in observations.items())))
        # Freeze the forecast when the preceding purchase's answer is available.
        # Never train on an answer received after this decision or on the target cycle.
        decision = max(available(a), available(labels[a['payload']['visitId']]))
        if decision >= end or ledger['status'] != 'comparable_receipt_endpoints':
            continue
        prior = [c['ledger']['captured_miles'] for j, c in enumerate(cycles[:-1])
                 if c['ledger']['status'] == 'comparable_receipt_endpoints'
                 and c['ledger']['collection_boundaries'] == 0
                 and all(available(labels[f['payload']['visitId']]) <= decision
                         for f in fuels[j:j + 2])
                 and fuels[j + 1]['payload']['mileageAtReceipt']['epoch'] == a['payload']['mileageAtReceipt']['epoch']]
        if len(prior) >= 3:
            prediction = statistics.median(prior[-3:])
            forecasts.append(dict(cycle=i + 1, known_prior_ledger_cycles=len(prior),
                                  predicted_miles=prediction, observed_miles=ledger['captured_miles'],
                                  error_miles=prediction-ledger['captured_miles']))
    policy = replay(timing, minimum_cycles=3, lead_miles=10) if len(fuels) >= 4 else []
    locations = [e for e in events if e['kind'] == 'location']
    snapshots = [e for e in events if e['payload'].get('mileageAtReceipt')]
    latest = max(snapshots, key=lambda e: e['recordedAt'])['payload']['mileageAtReceipt'] if snapshots else None
    comparables = [c['ledger'] for c in cycles if c['ledger']['status'] == 'comparable_receipt_endpoints']
    latest_event = max(snapshots, key=available) if snapshots else None
    since_purchase = ledger_interval(fuels[-1], latest_event) if fuels and latest_event else dict(status='missing_endpoint')
    if fuels and latest_event:
        since_purchase['receipt_hours_since_purchase'] = (available(latest_event)-available(fuels[-1]))/3600
        since_purchase['is_since_full_tank'] = False
    return dict(account=account, observed_visits=len(observations), confirmed_purchases=len(fuels),
                labels=dict(collections.Counter(e['payload']['label'] for e in labels.values())),
                unanswered_observed_visits=sum(vid not in labels for vid in observations),
                saved_locations=len(locations), legacy_valid_locations=sum(valid_fix(e) for e in locations),
                ledger_snapshots=len(snapshots), ledger_epochs=len({e['payload']['mileageAtReceipt']['epoch'] for e in snapshots}),
                latest_ledger={k: latest[k] for k in ('capturedMeters', 'acceptedSamples', 'gapCount',
                              'unmeasuredGapSeconds', 'collectionBoundaryCount', 'completeOdometer')} if latest else None,
                comparable_ledger_cycles=len(comparables),
                latest_captured_distance_since_confirmed_purchase=since_purchase,
                purchases_with_ledger=sum(bool(e['payload'].get('mileageAtReceipt')) for e in fuels),
                purchases_answered_over_one_hour_later=sum(
                    available(labels[e['payload']['visitId']])-e['payload']['startedAt'] > 3600 for e in fuels),
                cycles_without_recorded_gaps_or_boundaries=sum(c['gap_count'] == 0 and c['collection_boundaries'] == 0 for c in comparables),
                purchase_observation_delay_seconds=summarize([e['recordedAt']-e['payload']['startedAt'] for e in fuels]),
                purchase_answer_delay_minutes=summarize([(available(labels[e['payload']['visitId']])-e['payload']['startedAt']) / 60 for e in fuels]),
                cycles=cycles, ledger_last_three_median_forecasts=forecasts,
                legacy_fixed_policy=dict(minimum_cycles=3, lead_miles=10, alerts=len(policy),
                    within_0_to_20_captured_miles=sum(a['within_evaluation_distance_window'] is True for a in policy),
                    outside_window=sum(a['within_evaluation_distance_window'] is False for a in policy),
                    unknown_next_purchase=sum(a['within_evaluation_distance_window'] is None for a in policy),
                    observed_miles_until_next_confirmed_purchase=[a['observed_miles_until_next_confirmed_fill'] for a in policy]))


def main(base, output, cutoff):
    groups, files = load(base, epoch(cutoff))
    accounts = [account_report(es, i) for i, es in enumerate(groups, 1)]
    kinds = json.loads((base / 'kinds.json').read_text())['data']['rows']
    counts = {r['kind']: r['n'] for r in kinds}
    assert sum(a['saved_locations'] for a in accounts) == counts['location']
    assert sum(a['observed_visits'] for a in accounts) == counts['visit_observation']
    baseline_path = Path(__file__).resolve().parents[2] / 'docs/operations/2026-10-13-mileage-only/results.json'
    baseline = json.loads(baseline_path.read_text())
    comparable = [c['ledger'] for a in accounts for c in a['cycles']
                  if c['ledger']['status'] == 'comparable_receipt_endpoints']
    new_miles = sum(c['captured_miles'] for c in comparable)
    old_miles = sum(c['legacy_miles_between_receipts'] for c in comparable)
    result = dict(frozen_server_received_before=cutoff,
                  research_events=sum(counts.values()), kinds=counts,
                  comparison_to_oct13=dict(
                      baseline_sha256=hashlib.sha256(baseline_path.read_bytes()).hexdigest(),
                      confirmed_purchases_before=sum(a['confirmed_fills'] for a in baseline['accounts']),
                      confirmed_purchases_now=sum(a['confirmed_purchases'] for a in accounts),
                      purchase_intervals_before=sum(len(a['observed_cycle_miles']) for a in baseline['accounts']),
                      purchase_intervals_now=sum(len(a['cycles']) for a in accounts),
                      repeat_purchase_accounts_before=sum(a['confirmed_fills'] >= 2 for a in baseline['accounts']),
                      repeat_purchase_accounts_now=sum(a['confirmed_purchases'] >= 2 for a in accounts)),
                  paired_distance_comparison=dict(intervals=len(comparable), ledger_miles=new_miles,
                      legacy_saved_fix_miles=old_miles, additional_captured_percent=(new_miles/old_miles-1)*100 if old_miles else None,
                      interpretation='Same receipt endpoints. Difference is not an accuracy score; neither measurement was validated against a vehicle odometer.'),
                  methods=dict(ledger='Differences at first visit-observation receipt; not backdated to arrival. Gaps may be parked time. Zero gaps do not prove odometer completeness.',
                               legacy='Unchanged October 13 replay, three prior cycles and 10 captured mile lead. Latest labels score outcomes; only then-known labels train forecasts.',
                               forecast='Prior three ledger cycle median, frozen at prior purchase answer. Exploratory, permits recorded gaps; not a production qualification.',
                               target='Confirmed purchases only. No measured low-fuel, full-tank, fuel quantity or vehicle-specific odometer ground truth.'),
                  input_hashes={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files + [base / 'kinds.json']},
                  source_hashes={name: hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
                                 for name in ('auditMileageCoverage.py', 'backtestMileageOnly.py', 'timingFeatures.py', 'mileageReadiness.py', 'backtestAnticipation.py')},
                  accounts=accounts)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({k: sum(a[k] for a in accounts) for k in ('confirmed_purchases', 'observed_visits', 'unanswered_observed_visits', 'comparable_ledger_cycles', 'cycles_without_recorded_gaps_or_boundaries')}))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
