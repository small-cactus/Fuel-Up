"""Explore automatic mileage-confidence gates using already-collected evidence.

Offline only. No imputed purchase, tank size, route distance, or fuel quantity.
Replay all saved driving fixes, including times far from confirmed purchases.
Input is the protected October 22 audit export plus context-locations and aux
exports from the same upload cutoff. Output contains anonymous aggregates only.
"""
import bisect
import collections
import hashlib
import json
import math
import statistics
import sys
from pathlib import Path

from auditMileageCoverage import epoch
from backtestAnticipation import available, valid_fix
from backtestMileageOnly import distance_between, replay as original_replay
from mileageReadiness import MileageReadiness, ready
from timingFeatures import TimingFeatures
from mileageGapEvidence import evidence as gap_evidence
from automaticRefuelEvidence import infer as infer_stops

POLICIES = ('baseline', 'stable_cycles', 'no_unanswered_substantial_stop',
            'stable_and_no_unanswered_stop', 'recent_navigation', 'no_detected_gap_driving',
            'ledger_and_no_detected_gap_driving')


class AutomaticEvidence:
    """Only evidence already received may alter confidence, never fuel truth."""
    def __init__(self):
        self.visits = {}
        self.labels = {}
        self.context = {}

    def ingest(self, event):
        p = event['payload']
        if event['kind'] in ('visit_observation', 'visit_candidate', 'visit_departure', 'visit_gap'):
            v = self.visits.setdefault(p['visitId'], dict(start=p['startedAt'], dwell=0, samples=0))
            v['dwell'] = max(v['dwell'], p.get('lastInsideAt', p['startedAt'])-p['startedAt'])
            v['samples'] = max(v['samples'], p.get('samples', 0))
        if event['kind'] == 'visit_label':
            self.labels[p['visitId']] = p['label']
        c = p.get('contextAtReceipt')
        if c and c.get('sampledAt', available(event)) <= available(event):
            self.context = c

    def unresolved_stops(self, anchor):
        return sum(v['start'] > anchor and v['dwell'] >= 180 and v['samples'] >= 3
                   and self.labels.get(vid) not in ('fueled', 'not_fueling', 'not_a_stop')
                   for vid, v in self.visits.items())

    def navigated(self, now):
        timestamp = self.context.get('station_goAt')
        return timestamp is not None and 0 <= now-timestamp <= 900


def stable(cycles):
    recent = cycles[-3:]
    return len(recent) == 3 and min(recent) > 0 and max(recent) / min(recent) <= 1.5


def decisions(cycles, unresolved, navigated, gap_risks=0, ledger_anchor=False):
    return dict(baseline=True, stable_cycles=stable(cycles),
                no_unanswered_substantial_stop=unresolved == 0,
                stable_and_no_unanswered_stop=stable(cycles) and unresolved == 0,
                recent_navigation=navigated, no_detected_gap_driving=gap_risks == 0,
                ledger_and_no_detected_gap_driving=ledger_anchor and gap_risks == 0)


def load(base, cutoff):
    files = [base/'visits.json'] + sorted(base.glob('locations-*.json'))
    files += sorted(base.glob('context-locations-*.json')) + sorted(base.glob('aux-*.json'))
    rows = {}
    for f in files:
        r = json.loads(f.read_text())
        if not r['ok']:
            raise ValueError(f'Failed export {f.name}')
        for row in r['data']['rows']:
            if epoch(row['received_at']) >= cutoff:
                raise ValueError('Outside frozen upload window')
            key = row['participant_id'], row['id']
            e = dict(row.get('event') or dict(id=row['id'], kind=row['kind'],
                     recordedAt=epoch(row['recorded_at']), payload=row['payload']))
            if isinstance(e['payload'], str):
                e['payload'] = json.loads(e['payload'])
            if key in rows:
                if not f.name.startswith('context-locations-'):
                    raise ValueError('Unexpected duplicate export')
                for k, v in rows[key]['payload'].items():
                    if e['payload'].get(k) != v:
                        raise ValueError('Context enrichment changed original measurement')
            rows[key] = e
    groups = collections.defaultdict(list)
    for (participant, _), e in rows.items():
        groups[participant].append(e)
    return sorted(groups.values(), key=len, reverse=True), files


def replay(events, provisional=None):
    timing = TimingFeatures(events)
    model = MileageReadiness(timing)
    risks, gap_report = gap_evidence(events)
    evidence = AutomaticEvidence()
    ordered = sorted(events, key=lambda e: (available(e), e['id']))
    cursor = 0
    truth = sorted((v for v in timing.visits.values() if timing.truth.get(v['id']) == 'fueled'), key=lambda v: v['arrival'])
    alerted = {p: set() for p in POLICIES}
    results = {p: [] for p in POLICIES}
    previous_distance = None
    latest_ledger = None
    anchor_ledgers = {}
    for now in sorted(set(timing.times)):
        while cursor < len(ordered) and available(ordered[cursor]) <= now:
            event = ordered[cursor]
            evidence.ingest(event)
            m = event['payload'].get('mileageAtReceipt')
            if m:
                latest_ledger = m
                if event['kind'] == 'visit_observation':
                    anchor_ledgers.setdefault(event['payload']['visitId'], m)
            cursor += 1
        total = timing.totals(now)[0]
        increased = previous_distance is not None and total > previous_distance
        previous_distance = total
        if not increased:
            continue
        snapshot = model.snapshot(now, minimum_cycles=3)
        history = timing.history(now)
        if not history:
            continue
        anchor = history[-1]
        # Optional what-if: a likely purchase can move the distance anchor, but
        # it cannot become a training label, add a completed cycle or score itself.
        candidates = [p for p in provisional or [] if p['known_at'] <= now and p['arrival'] > anchor['arrival']]
        if candidates:
            p = max(candidates, key=lambda p: p['arrival'])
            anchor = dict(id=p['visit'], arrival=p['arrival'])
            snapshot['predicted_miles_remaining'] = snapshot['typical_observed_fill_miles'] - distance_between(timing, p['arrival'], now)
        if not ready(snapshot, 10):
            continue
        cycles = [distance_between(timing, a['arrival'], b['arrival']) for a, b in zip(history, history[1:])]
        cycles = [c for c in cycles if c > 0]
        unresolved = evidence.unresolved_stops(anchor['arrival'])
        gap_risks = sum(g['start'] >= anchor['arrival'] and g['known'] <= now for g in risks)
        anchor_ledger = anchor_ledgers.get(anchor['id'])
        ledger_anchor = bool(anchor_ledger and latest_ledger and
                             anchor_ledger['epoch'] == latest_ledger['epoch'] and
                             anchor_ledger['collectionBoundaryCount'] == latest_ledger['collectionBoundaryCount'])
        gates = decisions(cycles, unresolved, evidence.navigated(now), gap_risks, ledger_anchor)
        for name in POLICIES:
            if not gates[name] or anchor['id'] in alerted[name]:
                continue
            alerted[name].add(anchor['id'])
            target = next((v for v in truth if v['arrival'] > now), None)
            miles = distance_between(timing, now, target['arrival']) if target else None
            results[name].append(dict(target=target['id'] if target else None,
                miles_until_next_purchase=miles, within_window=0 < miles <= 20 if miles is not None else None,
                unresolved_substantial_stops=unresolved, recent_cycle_ratio=max(cycles[-3:])/min(cycles[-3:]),
                detected_gap_driving=gap_risks, comparable_ledger_anchor=ledger_anchor,
                partition='after_oct13' if now >= epoch('2026-10-14T00:00:00Z') else 'through_oct13'))
    policies = {}
    for name, alerts in results.items():
        policies[name] = dict(alerts=len(alerts),
            near_purchase=sum(a['within_window'] is True for a in alerts),
            outside_window=sum(a['within_window'] is False for a in alerts),
            unknown=sum(a['within_window'] is None for a in alerts),
            distinct_near_purchases=len({a['target'] for a in alerts if a['within_window'] is True}),
            details=[{k: v for k, v in a.items() if k != 'target'} for a in alerts])
    return timing, policies, gap_report


def signal_coverage(events, timing):
    ordered = sorted(events, key=lambda e: (available(e), e['id']))
    contexts = [e for e in ordered if e['payload'].get('contextAtReceipt')
                and e['payload']['contextAtReceipt'].get('sampledAt', available(e)) <= available(e)]
    context_times = [available(e) for e in contexts]
    ports = collections.Counter()
    actions = collections.defaultdict(set)
    for e in contexts:
        c = e['payload']['contextAtReceipt']
        for p in c.get('audioOutputPortTypes', []):
            ports[p] += 1
        for action in ('app_open', 'station_select', 'station_go'):
            if c.get(action+'At') is not None and c[action+'At'] <= available(e):
                actions[action].add(c[action+'At'])
    pre = collections.Counter()
    for v in timing.visits.values():
        if timing.truth.get(v['id']) != 'fueled':
            continue
        now = v['arrival']-300
        i = bisect.bisect_right(context_times, now)-1
        pre['purchases'] += 1
        if i < 0 or now-context_times[i] > 120:
            pre['missing_fresh_context_five_minutes_before'] += 1
            continue
        c = contexts[i]['payload']['contextAtReceipt']
        pre['fresh_context_five_minutes_before'] += 1
        for action in ('app_open', 'station_select', 'station_go'):
            if c.get(action+'At') is not None and 0 <= now-c[action+'At'] <= 900:
                pre[action+'_within_preceding_15_minutes'] += 1
    # Steps are evidence of movement at a stop, not evidence of fuel purchase.
    visit_steps = {}
    for e in ordered:
        p = e['payload']
        if e['kind'] == 'visit_pedometer' and p.get('status') == 'available':
            visit_steps[p['visitId']] = p.get('steps')
    steps = {}
    for label in ('fueled', 'not_fueling', 'not_a_stop'):
        values = [n for vid, n in visit_steps.items() if timing.truth.get(vid) == label and isinstance(n, (int, float))]
        steps[label] = dict(n=len(values), minimum=min(values) if values else None,
                            median=statistics.median(values) if values else None, maximum=max(values) if values else None)
    sources = collections.Counter(e['payload'].get('source') for e in ordered if e['kind'] == 'diagnostic')
    return dict(context_snapshots=len(contexts), audio_port_observations=dict(ports),
                unique_actions={k: len(v) for k, v in actions.items()}, pre_purchase_context=dict(pre),
                post_stop_steps=steps, motion_history_responses=sources.get('apple_motion_history', 0))


def main(base, output, cutoff):
    groups, files = load(base, epoch(cutoff))
    event_counts = collections.Counter(e['kind'] for es in groups for e in es)
    expected = {r['kind']: r['n'] for r in json.loads((base/'kinds.json').read_text())['data']['rows']}
    assert all(n == expected[k] for k, n in event_counts.items()), 'Incomplete source export'
    accounts = []
    for i, events in enumerate(groups, 1):
        timing, policies, gap_report = replay(events)
        original = original_replay(timing, minimum_cycles=3, lead_miles=10)
        assert [a['miles_until_next_purchase'] for a in policies['baseline']['details']] == [
            a['observed_miles_until_next_confirmed_fill'] for a in original], 'Baseline changed'
        predictions, stop_report = infer_stops(events)
        provisional_policy = replay(events, predictions)[1]['baseline'] if predictions else policies['baseline']
        accounts.append(dict(account=i, purchases=sum(v == 'fueled' for v in timing.truth.values()),
                             policies=policies, signals=signal_coverage(events, timing), gap_evidence=gap_report,
                             habitual_stop_inference=stop_report, provisional_anchor_replay=provisional_policy))
        print('Finished anonymous account', i, flush=True)
    result = dict(frozen_server_received_before=cutoff,
        analyzed_event_counts=dict(event_counts), analyzed_events=sum(event_counts.values()),
        method='Same mileage predictor, three prior cycles, ten-mile lead, one warning per confirmed-purchase anchor. Gates use only already-received evidence. Stable means last three cycle max/min <=1.5. Substantial unknown stop means >=180 seconds and >=3 observed samples, without a definitive answer.',
        limitations=['Exploratory reuse of an inspected dataset; no untouched holdout or production precision claim.',
                     '0-20 captured miles to next confirmed purchase is the score, not low-tank truth.',
                     'Suppressing every warning is not a successful predictor. Report retained coverage.',
                     'Unknown substantial stops suppress confidence only; they never reset mileage or become inferred purchases.',
                     'Separate habitual-stop what-if moves a provisional anchor only; original confirmed answers remain the training and scoring truth. Ten guesses from one person would not establish general precision.',
                     'Gap analysis requires exact ledger-counter endpoints and complete motion-history chunks. Interior excludes 120 seconds at each endpoint and requires >=60 seconds of automotive classification; it estimates no missing miles.',
                     'Post-stop walking and recovered motion cannot justify earlier alerts before those responses arrived.'],
        input_hashes={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files+[base/'kinds.json']},
        source_hashes={n:hashlib.sha256((Path(__file__).parent/n).read_bytes()).hexdigest() for n in
                       ('inferMileageConfidence.py', 'mileageGapEvidence.py', 'automaticRefuelEvidence.py', 'auditMileageCoverage.py', 'backtestMileageOnly.py', 'mileageReadiness.py', 'timingFeatures.py', 'backtestAnticipation.py')},
        accounts=accounts)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
