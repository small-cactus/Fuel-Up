"""Offline feasibility of station prediction inside a personal mileage bracket.

Uses the frozen mileage-audit export. No new collection or app behavior changes.
Past confirmed purchases supply approach templates; future answers score only.
Raw locations, identities, station IDs and timestamps are not exported.
"""
import bisect
import collections
import datetime
import hashlib
import json
import math
import sys
from pathlib import Path

from auditMileageCoverage import epoch
from backtestAnticipation import available, distance, valid_fix
from inferMileageConfidence import load
from mileageReadiness import MileageReadiness
from timingFeatures import TimingFeatures

POLICIES = ('habit', 'route', 'sequence', 'sequence_150m', 'sequence_100m',
            'sequence_two_prior', 'sequence_stable_cycles', 'sequence_clock')


def strict_score(counts):
    """Every emitted prediction needs a confirmed match; abstention is not success."""
    total = counts.get('predictions', 0)
    correct = counts.get('correct_purchase_station', 0)
    return dict(correct=correct, wrong=total-correct,
                correct_prediction_rate=correct/total if total else None)


def inside_bracket(snapshot):
    return (snapshot['known_mileage_cycles'] >= 3
            and snapshot['recent_cycle_min_miles'] - 10
            <= snapshot['observed_miles_since_fill']
            <= snapshot['recent_cycle_max_miles'] + 10)


def match(p, q):
    if not (p.get('speed', -1) >= 2.5 and q.get('speed', -1) >= 2.5
            and 0 <= p.get('course', -1) < 360 and 0 <= q.get('course', -1) < 360):
        return None
    angle = abs((p['course'] - q['course'] + 180) % 360 - 180)
    if angle > 45:
        return None
    meters = distance((p['latitude'], p['longitude']), (q['latitude'], q['longitude']))
    return meters if meters <= 300 else None


class RouteWindow:
    def __init__(self, events):
        self.timing = TimingFeatures(events)
        self.mileage = MileageReadiness(self.timing)
        self.visits = {}
        for e in sorted(events, key=available):
            if e['kind'] == 'visit_observation':
                p = e['payload']
                self.visits.setdefault(p['visitId'], dict(id=p['visitId'], station=str(p['stationId']),
                    arrival=p['startedAt'], known=available(e)))
        self.outcomes = sorted(self.visits.values(), key=lambda v: v['arrival'])
        self.arrivals = [v['arrival'] for v in self.outcomes]
        self.templates = {}
        for v in self.outcomes:
            lo = bisect.bisect_left(self.timing.times, v['arrival'] - 900)
            hi = bisect.bisect_right(self.timing.times, v['arrival'] - 60)
            # All eligible fixes retained: template sampling must not use a future minute's fix.
            self.templates[v['id']] = self.timing.fixes[lo:hi]

    def predict(self, now):
        history = self.timing.history(now)
        counts = collections.Counter(self.visits[v['id']]['station'] for v in history)
        recent = {self.visits[v['id']]['station']: v['arrival'] for v in history}
        habit = max(counts, key=lambda s: (counts[s], recent[s])) if counts else None
        snapshot = self.mileage.snapshot(now, minimum_cycles=3)
        result = dict(habit=habit, route=None, sequence=None, bracket=inside_bracket(snapshot),
                      fresh=False, moving=False, prior_station_count=len(counts))
        result.update({p: None for p in POLICIES if p not in result})
        fix = self.timing.fix(now)
        if not fix:
            return result
        result['fresh'] = True
        p = fix['payload']
        result['moving'] = p.get('speed', -1) >= 2.5 and 0 <= p.get('course', -1) < 360
        if not result['moving']:
            return result
        # Three ordered fixes spanning at least 60 seconds, with no >45s gap.
        live = []
        for offset in (60, 30, 0):
            f = self.timing.fix(now-offset)
            if f is None or not 0 <= now-offset-f['payload']['timestamp'] <= 15:
                live = []
                break
            live.append(f['payload'])
        if live and not (live[-1]['timestamp']-live[0]['timestamp'] >= 60
                         and all(0 < b['timestamp']-a['timestamp'] <= 45 for a, b in zip(live, live[1:]))):
            live = []
        matches = []
        sequence_matches = []
        tight_matches = {100: [], 150: []}
        for v in history:
            template = [f for f in self.templates[v['id']] if available(f) <= now]
            sid = self.visits[v['id']]['station']
            for index, f in enumerate(template):
                d = match(p, f['payload'])
                if d is None:
                    continue
                matches.append((d, -v['arrival'], sid))
                if not live:
                    continue
                # Require an ordered historical match, not three matches to one point.
                prior = []
                for q in reversed(template[:index]):
                    dt = f['payload']['timestamp']-q['payload']['timestamp']
                    if dt > 180:
                        break
                    if 15 <= dt <= 90 and match(live[1], q['payload']) is not None:
                        prior.append(q)
                errors = []
                for b in prior:
                    for a in template[:index]:
                        if (45 <= f['payload']['timestamp']-a['payload']['timestamp'] <= 180
                                and a['payload']['timestamp'] < b['payload']['timestamp']):
                            first_distance = match(live[0], a['payload'])
                            if first_distance is not None:
                                errors.append(max(d, match(live[1], b['payload']), first_distance))
                if errors:
                    sequence_matches.append((d, -v['arrival'], sid))
                    for threshold, candidates in tight_matches.items():
                        if min(errors) <= threshold:
                            candidates.append((d, -v['arrival'], sid))
        if matches:
            result['route'] = min(matches)[2]
        if sequence_matches:
            sid = result['sequence'] = min(sequence_matches)[2]
            if counts[sid] >= 2:
                result['sequence_two_prior'] = sid
            if (snapshot['recent_cycle_min_miles'] > 0 and
                    snapshot['recent_cycle_max_miles']/snapshot['recent_cycle_min_miles'] <= 1.5):
                result['sequence_stable_cycles'] = sid
            if any(self.visits[v['id']]['station'] == sid
                   and abs((v['arrival']-now+43200) % 86400-43200) <= 3600 for v in history):
                result['sequence_clock'] = sid
        for threshold, candidates in tight_matches.items():
            if candidates:
                result[f'sequence_{threshold}m'] = min(candidates)[2]
        return result

    def outcome(self, now, station, end):
        index = bisect.bisect_right(self.arrivals, now)
        v = self.outcomes[index] if index < len(self.outcomes) else None
        if v and v['arrival'] <= now+900:
            label = self.timing.truth.get(v['id'], 'unanswered')
            if label == 'fueled':
                return ('correct_purchase_station' if station == v['station'] else 'wrong_purchase_station'), v
            if label in ('not_fueling', 'not_a_stop'):
                return 'explicit_nonpurchase', v
            return 'unanswered_encounter', v
        return ('end_censored' if now+900 > end else 'no_observed_encounter'), None


def evaluate(base, cutoff, new_period_start=None):
    groups, files = load(base, cutoff)
    report = dict(method=dict(
        upload_cutoff_utc=datetime.datetime.fromtimestamp(cutoff, datetime.timezone.utc).isoformat(),
        strict_scoring='Unanswered, no encounter, wrong station, explicit nonpurchase and end-censored predictions all count as wrong. Raw outcomes remain unchanged. Zero predictions has no rate.',
        new_period_start_utc=datetime.datetime.fromtimestamp(new_period_start, datetime.timezone.utc).isoformat() if new_period_start else None,
        candidates='Predeclared exploratory sequence gates: all three matched points <=150m or <=100m; at least two prior purchases at chosen station; recent cycle max/min <=1.5; any prior purchase at chosen station within one hour of time of day (UTC). Separate cooldown per policy.',
        bracket='Last three positive captured-mile intervals min to max, padded by 10 miles each side; at least three prior intervals. Exploratory envelope, not learned multimodal brackets or measured tank range.',
        route='Same-person previously confirmed purchase approach, 1-15 minutes before arrival; current fix within 300m and course within 45 degrees; nearest match wins.',
        sequence='Same route rule plus three ordered fixes over at least 60 seconds, compared to an ordered historical approach. No road-network map matching.',
        continuous='First moving valid fix each minute, within mileage bracket; separate policy alerts, 30-minute cooldown; next detected encounter within 15 minutes scores outcome.',
        availability='Phone receipt/recorded times, with purchase labels known before prediction. Server upload times restrict export only. Future labels used only for scoring.',
        limits=['Exploratory replay on previously inspected data, not an untouched holdout.',
                'Sparse purchase labels; unanswered encounters and absent encounters are unknown, not confirmed negatives.',
                'GPS captured miles omit travel gaps. No fuel level, full-tank, driver or vehicle identity truth.',
                'Predicting a familiar station conditional on a purchase does not establish that a purchase is imminent.',
                'This evaluates familiar stations only; it cannot discover an unseen preferred station.']),
        accounts=[], continuous={}, landmarks={})
    aggregates = {p: collections.Counter() for p in POLICIES}
    periods = {name: {p: collections.Counter() for p in POLICIES} for name in ('earlier', 'new')}
    leads = {p: [] for p in aggregates}
    caught = {p: set() for p in aggregates}
    correct_accounts = {p: set() for p in aggregates}
    correct_stations = {p: set() for p in aggregates}
    landmarks = {str(m): collections.Counter() for m in (1, 3, 5, 10, 15)}
    for account, events in enumerate(groups, 1):
        engine = RouteWindow(events)
        purchases = [v for v in engine.outcomes if engine.timing.truth.get(v['id']) == 'fueled']
        if not purchases:
            continue
        station_counts = collections.Counter(v['station'] for v in purchases)
        ac = dict(account=account, confirmed_purchases=len(purchases), distinct_purchase_stations=len(station_counts),
                  purchases_per_station=sorted(station_counts.values(), reverse=True), continuous={})
        report['accounts'].append(ac)
        for minutes, c in landmarks.items():
            for v in purchases:
                pred = engine.predict(v['arrival']-int(minutes)*60)
                c['purchases'] += 1
                c['fresh_location'] += pred['fresh']
                c['in_bracket'] += pred['bracket']
                c['multiple_prior_stations'] += pred['prior_station_count'] >= 2
                for policy in aggregates:
                    sid = pred[policy]
                    if sid is not None:
                        c[policy+'_predictions'] += 1
                        c[policy+'_correct'] += sid == v['station']
                        if sid == v['station']:
                            c[policy+'_correct_also_habit'] += pred['habit'] == sid
                        if pred['bracket']:
                            c[policy+'_bracket_predictions'] += 1
                            c[policy+'_bracket_correct'] += sid == v['station']
        last = {p: -math.inf for p in aggregates}
        end = max(available(e) for e in events)
        seen_minutes = set()
        for f in engine.timing.fixes:
            now = available(f)
            minute = int(now//60)
            if minute in seen_minutes or f['payload'].get('speed', -1) < 2.5:
                continue
            seen_minutes.add(minute)
            pred = engine.predict(now)
            if not pred['bracket']:
                continue
            for policy, c in aggregates.items():
                c['moving_minutes_in_bracket'] += 1
                sid = pred[policy]
                if sid is None or now-last[policy] < 1800:
                    continue
                last[policy] = now
                outcome, v = engine.outcome(now, sid, end)
                c['predictions'] += 1
                c[outcome] += 1
                period = 'new' if new_period_start is not None and now >= new_period_start else 'earlier'
                periods[period][policy]['predictions'] += 1
                periods[period][policy][outcome] += 1
                ac['continuous'].setdefault(policy, collections.Counter())[outcome] += 1
                if outcome == 'correct_purchase_station':
                    caught[policy].add((account, v['id']))
                    correct_accounts[policy].add(account)
                    correct_stations[policy].add((account, sid))
                    leads[policy].append(round((v['arrival']-now)/60, 2))
    report['landmarks'] = {k: dict(v) for k, v in landmarks.items()}
    report['continuous'] = {p: dict(c, **strict_score(c), distinct_purchases_caught=len(caught[p]),
                                  accounts_with_correct_predictions=len(correct_accounts[p]),
                                  personal_stations_correctly_predicted=len(correct_stations[p]),
                                  correct_lead_minutes=leads[p])
                            for p, c in aggregates.items()}
    report['periods'] = {name: {p: dict(c, **strict_score(c)) for p, c in policies.items()}
                         for name, policies in periods.items()}
    report['input_sha256'] = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
    report['source_sha256'] = {name: hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest()
                               for name in ('auditRouteWindow.py', 'timingFeatures.py', 'mileageReadiness.py', 'backtestAnticipation.py')}
    return report


if __name__ == '__main__':
    result = evaluate(Path(sys.argv[1]), epoch(sys.argv[3]), epoch(sys.argv[4]) if len(sys.argv) > 4 else None)
    Path(sys.argv[2]).write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: result[k] for k in ('accounts', 'landmarks', 'continuous')}, indent=2))
