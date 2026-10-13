"""Replay mileage-only forecasts using a protected research.json export.

No route, station identity, app usage, elapsed-time, or time-of-day predictors.
Usage: python3 backtestMileageOnly.py PRIVATE_DIRECTORY OUTPUT_DIRECTORY
Only anonymous distance aggregates are written to OUTPUT_DIRECTORY.
"""
import collections
import hashlib
import json
import math
import statistics
import sys
from pathlib import Path
from backtestAnticipation import available
from mileageReadiness import MileageReadiness, KM_PER_MILE, ready
from timingFeatures import TimingFeatures


def load(base):
    groups = collections.defaultdict(list)
    rows = json.loads((base / 'research.json').read_text())
    for row in rows:
        event = dict(row['event'])
        if isinstance(event['payload'], str):
            event['payload'] = json.loads(event['payload'])
        groups[row['participant_id']].append(event)
    return [(account, TimingFeatures(events)) for account, events in
            enumerate(sorted(groups.values(), key=len, reverse=True), 1)]


def distance_between(timing, start, end):
    return (timing.totals(end)[0] - timing.totals(start)[0]) / KM_PER_MILE


def replay(timing, minimum_cycles=1, lead_miles=10, rule='last_three_median'):
    model = MileageReadiness(timing)
    # Retrospective answers are used ONLY for scoring, never by snapshot().
    truth = sorted((v for v in timing.visits.values()
                    if timing.truth.get(v['id']) == 'fueled'), key=lambda v: v['arrival'])
    alerted = set()
    alerts = []
    previous_distance = None
    for cutoff in sorted(set(timing.times)):
        total = timing.totals(cutoff)[0]
        increased = previous_distance is not None and total > previous_distance
        previous_distance = total
        if not increased:
            continue
        snapshot = model.snapshot(cutoff, minimum_cycles, rule)
        fill_id = snapshot['last_fill_id']
        if fill_id in alerted or not ready(snapshot, lead_miles):
            continue
        alerted.add(fill_id)
        target = next((v for v in truth if v['arrival'] > cutoff), None)
        miles = distance_between(timing, cutoff, target['arrival']) if target else None
        alerts.append(dict(
            known_mileage_cycles=snapshot['known_mileage_cycles'],
            observed_miles_since_fill=snapshot['observed_miles_since_fill'],
            predicted_cycle_miles=snapshot['typical_observed_fill_miles'],
            observed_miles_until_next_confirmed_fill=miles,
            within_evaluation_distance_window=(0 < miles <= 2 * lead_miles) if miles is not None else None,
        ))
    return alerts


def cycle_forecasts(timing, rule):
    """Freeze each forecast when the preceding fill first becomes known.

This avoids selecting a convenient prediction moment just before the outcome.
Later confirmed answers may revise the ongoing replay, but never this forecast.
"""
    truth = sorted((v for v in timing.visits.values()
                    if timing.truth.get(v['id']) == 'fueled'), key=lambda v: v['arrival'])
    model = MileageReadiness(timing)
    results = []
    for start, end in zip(truth, truth[1:]):
        observations = [v for v, vid, label in timing.labels if vid == start['id'] and label == 'fueled']
        if not observations:
            continue
        decision = max(min(observations), start['known_at'], start['arrival'] + .001)
        if decision >= end['arrival']:
            continue
        snapshot = model.snapshot(decision, rule=rule)
        if snapshot['last_fill_id'] != start['id'] or not math.isfinite(snapshot['typical_observed_fill_miles']):
            continue
        actual = distance_between(timing, start['arrival'], end['arrival'])
        predicted = snapshot['typical_observed_fill_miles']
        results.append(dict(prior_completed_cycles=snapshot['known_mileage_cycles'],
                            predicted_cycle_miles=predicted, observed_cycle_miles=actual,
                            error_miles=predicted - actual))
    return results


def main(base, output):
    accounts = []
    for account, timing in load(base):
        fuels = sorted((v for v in timing.visits.values() if timing.truth.get(v['id']) == 'fueled'),
                       key=lambda v: v['arrival'])
        if not fuels:
            continue
        cycles = [distance_between(timing, a['arrival'], b['arrival']) for a, b in zip(fuels, fuels[1:])]
        forecasts = {rule: cycle_forecasts(timing, rule) for rule in ('last_interval', 'last_three_median')}
        policies = {}
        for minimum in (1, 2, 3):
            for lead in (5, 10, 20):
                alerts = replay(timing, minimum, lead)
                policies[f'minimum_{minimum}_cycles_lead_{lead}_miles'] = dict(
                    alerts=len(alerts), next_fill_observed=sum(a['within_evaluation_distance_window'] is not None for a in alerts),
                    inside_distance_window=sum(a['within_evaluation_distance_window'] is True for a in alerts),
                    outside_distance_window=sum(a['within_evaluation_distance_window'] is False for a in alerts),
                    unknown=sum(a['within_evaluation_distance_window'] is None for a in alerts),
                    details=alerts)
        accounts.append(dict(account=account, confirmed_fills=len(fuels), observed_cycle_miles=cycles,
                             forecasts=forecasts, policies=policies))
    result = dict(
        method='Mileage only: after two known confirmed fills, learn their captured travel interval. Update to the median of the latest three completed intervals; subtract accumulated miles after the latest known fill. One alert per confirmed-fill anchor.',
        evaluation='An alert with lead L miles is scored against the next confirmed fill in (0, 2L] captured miles. This distance-window score is not short-term notification precision or proof of imminent intent. Missing/unconfirmed purchases and GPS gaps remain unknown coverage.',
        limitations='Frozen exploratory snapshot, no prospective validation; no tank capacity, gallons, full-tank confirmation, odometer or complete travel coverage. At least two confirmed purchases are required, and only one account has repeated confirmed fills.',
        research_sha256=hashlib.sha256((base / 'research.json').read_bytes()).hexdigest(),
        source_hashes={name:hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
                       for name in ('backtestMileageOnly.py', 'mileageReadiness.py', 'timingFeatures.py', 'backtestAnticipation.py')},
        accounts=accounts)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'results.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    for account in accounts:
        print('Account', account['account'], 'cycles', [round(x, 1) for x in account['observed_cycle_miles']])
        for name, forecasts in account['forecasts'].items():
            print(name, 'errors', [round(x['error_miles'], 1) for x in forecasts])
        for name, policy in account['policies'].items():
            print(name, {k:v for k,v in policy.items() if k != 'details'})


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
