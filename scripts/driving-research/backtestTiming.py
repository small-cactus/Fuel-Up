"""Station-independent timing-only notification replay; emit private-data-free aggregates."""
import collections
import hashlib
import json
import math
import sys
from pathlib import Path

from backtestAnticipation import available, describe
from timingFeatures import TimingFeatures

POLICIES = ('clock', 'elapsed_cycle', 'driving_cycle', 'clock_and_cycle', 'before_departure')
NEGATIVES = {'not_fueling', 'not_a_stop'}


def evaluate(features):
    es = features.events
    start = min(available(e) for e in es)
    end = max(available(e) for e in es)
    positives = sorted((v for vid, v in features.visits.items() if features.truth.get(vid) == 'fueled'), key=lambda v: v['arrival'])
    negatives = [v for vid, v in features.visits.items() if features.truth.get(vid) in NEGATIVES]
    timeline = [(t, features.predict(t)) for t in range(math.ceil(start / 60) * 60, int(end), 60)]
    results = {}
    for policy in POLICIES:
        last = -math.inf
        per_day = collections.Counter()
        emitted = []
        for t, p in timeline:
            day = t // 86400
            if p[policy] and t - last >= 14400 and per_day[day] < 2:
                emitted.append(t)
                last = t
                per_day[day] += 1
        counts = collections.Counter()
        caught = set()
        caught_15 = set()
        lead = []
        departure_lead = []
        for t in emitted:
            matches = [v for v in positives if 300 <= v['arrival'] - t <= 3600]
            if matches:
                v = matches[0]
                counts['confirmed_fuel_5_to_60_minutes_later'] += 1
                caught.add(v['id'])
                lead.append((v['arrival'] - t) / 60)
                if v['arrival'] - t >= 900:
                    caught_15.add(v['id'])
                starts = [a for a in features.movement_starts if t < a < v['arrival']]
                if starts:
                    departure_lead.append((starts[0] - t) / 60)
            elif any(0 < v['arrival'] - t < 300 for v in positives):
                counts['confirmed_fuel_too_late_under_5_minutes'] += 1
            elif any(0 < v['arrival'] - t <= 3600 for v in negatives):
                counts['explicit_nonfuel_encounter_without_confirmed_fuel_match'] += 1
            elif any(0 < v['arrival'] - t <= 3600 for v in features.visits.values()):
                counts['unconfirmed_encounter_without_confirmed_fuel_match'] += 1
            else:
                counts['no_observed_encounter_in_window'] += 1
        results[policy] = {
            'alerts': len(emitted), 'alerts_per_day': round(len(emitted) / ((end - start) / 86400), 2),
            'outcomes': dict(counts), 'distinct_confirmed_fuel_stops_caught': len(caught),
            'distinct_confirmed_fuel_stops_with_15_minute_warning': len(caught_15),
            'fuel_warning_minutes': describe(lead),
            'warning_before_next_inferred_movement_start_minutes_for_fuel_matches': describe(departure_lead),
        }
    landmarks = {}
    for minutes in (5, 15, 30, 60):
        predictions = [features.predict(v['arrival'] - minutes * 60) for v in positives]
        landmarks[str(minutes)] = {
            'positive_opportunities': len(predictions),
            'with_two_prior_fuel_answers': sum(p['history_count'] >= 2 for p in predictions),
            'with_three_prior_fuel_answers': sum(p['history_count'] >= 3 for p in predictions),
            'fresh_location': sum(p['fresh_fix'] for p in predictions),
            'moving': sum(p['moving'] for p in predictions),
            'triggers': {policy: sum(p[policy] for p in predictions) for policy in POLICIES},
        }
    intervals = []
    for a, b in zip(positives, positives[1:]):
        intervals.append(features.totals(b['arrival'])[0] - features.totals(a['arrival'])[0])
    gaps = [b['payload']['timestamp'] - a['payload']['timestamp'] for a, b in zip(features.fixes, features.fixes[1:])]
    motion_delays = [available(e) - e['payload']['timestamp'] for e in es if e['kind'] == 'motion']
    # Presence within these windows measures recorded evidence, not absence of real motion.
    starts_before_fuel = []
    for v in positives:
        candidates = [t for t in features.movement_starts if v['arrival'] - 10800 <= t < v['arrival']]
        if candidates:
            starts_before_fuel.append((v['arrival'] - candidates[-1]) / 60)
    return {
        'protocol_version': 1, 'station_features_used': False, 'server_upload_delay_applied': False,
        'events': len(es), 'span_days': round((end-start)/86400, 2),
        'confirmed_fuel_stops': len(positives), 'explicit_negative_encounters': len(negatives),
        'unconfirmed_encounters': len(features.visits) - len(positives) - len(negatives),
        'wall_clock_minute_decisions': len(timeline),
        'minutes_with_fresh_location': sum(p['fresh_fix'] for _, p in timeline),
        'minutes_with_fresh_moving_location': sum(p['moving'] for _, p in timeline),
        'inferred_movement_starts': len(features.movement_starts),
        'latest_inferred_start_to_fuel_minutes': describe(starts_before_fuel),
        'observed_distance_between_positive_stops_km': describe(intervals),
        'valid_location_gaps_seconds': describe(gaps),
        'valid_location_gaps_over_15_minutes': sum(d > 900 for d in gaps),
        'motion_receipt_delay_seconds': describe(motion_delays),
        'motion_records_received_over_3_minutes_late': sum(d > 180 for d in motion_delays),
        'landmarks_minutes': landmarks, 'continuous_alerts': results,
        'limitations': [
            'Six self-reported fuel purchases from one selected person; not a calibrated model or unseen validation set.',
            'Unanswered purchases and non-fueling trips cannot be exhaustively identified.',
            'Movement session starts after observation gaps are not proven physical departures.',
            'Driving distance excludes gaps and is a lower bound, not odometer or tank consumption.',
            'UTC clock used consistently; longer replay needs recorded device timezone changes.',
            'Counterfactual one-minute execution is assumed; this does not verify iOS wake or notification delivery.',
        ],
    }


def main():
    source, output = map(Path, sys.argv[1:])
    events = [json.loads(line) for line in source.read_text().splitlines() if line]
    if len({e['id'] for e in events}) != len(events):
        raise ValueError('Duplicate event IDs')
    report = evaluate(TimingFeatures(events))
    report['input_sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
