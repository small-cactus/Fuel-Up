"""Local exploratory ML replay; private input and model files, aggregate reports.

No random split of adjacent GPS points. Only historical phone-available evidence
is a feature. Unanswered outcomes are failures by the requested scoring rule,
not verified biological/physical negatives or automatic mileage resets.
"""
import collections
import hashlib
import json
import math
import sys
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from auditMileageCoverage import epoch
from auditRouteWindow import RouteWindow, POLICIES
from backtestAnticipation import available, distance
from inferMileageConfidence import load

TRAIN_END = epoch('2026-10-18T00:00:00Z')
TEST_START = epoch('2026-10-22T14:10:00Z')
FEATURES = ['captured_miles_since_purchase', 'recent_cycle_min', 'recent_cycle_max',
            'recent_cycle_median', 'mileage_ratio', 'hours_since_purchase',
            'prior_purchases', 'prior_stations', 'candidate_prior_purchases',
            'candidate_purchase_share', 'habit_agrees', 'point_route_agrees',
            'sequence_agrees', 'sequence_150m_agrees', 'sequence_100m_agrees',
            'stable_cycle_sequence_agrees', 'prior_clock_sequence_agrees',
            'speed', 'gps_accuracy', 'fix_age_seconds', 'hour_sin', 'hour_cos',
            'nearest_historical_approach_meters']


def partition(now):
    # Embargo the full outcome horizon at both split boundaries.
    if now + 900 < TRAIN_END:
        return 'train'
    if TRAIN_END <= now and now + 900 < TEST_START:
        return 'validation'
    if now >= TEST_START:
        return 'test'
    return 'embargo'


def as_of_truth(engine, cutoff):
    return {vid: value for at, vid, value in engine.timing.labels if at < cutoff}


def features(engine, now, pred, sid):
    history = engine.timing.history(now)
    snapshot = engine.mileage.snapshot(now, minimum_cycles=3)
    p = engine.timing.fix(now)['payload']
    same = [v for v in history if engine.visits[v['id']]['station'] == sid]
    approach = [f['payload'] for v in same for f in engine.templates[v['id']] if available(f) <= now]
    nearest = min((distance((p['latitude'], p['longitude']), (q['latitude'], q['longitude']))
                   for q in approach), default=50000)
    angle = 2*math.pi*(now % 86400)/86400
    values = [snapshot['observed_miles_since_fill'], snapshot['recent_cycle_min_miles'],
              snapshot['recent_cycle_max_miles'], snapshot['typical_observed_fill_miles'],
              snapshot['mileage_due_ratio'], (now-history[-1]['arrival'])/3600,
              len(history), pred['prior_station_count'], len(same), len(same)/len(history),
              *[pred[k] == sid for k in ('habit', 'route', 'sequence', 'sequence_150m', 'sequence_100m',
                                         'sequence_stable_cycles', 'sequence_clock')],
              p['speed'], p['accuracy'], now-p['timestamp'], math.sin(angle), math.cos(angle), min(nearest, 50000)]
    assert len(values) == len(FEATURES) and all(math.isfinite(x) for x in values)
    return values


def build_rows(groups, cutoff):
    rows = []
    for account, events in enumerate(groups, 1):
        engine = RouteWindow(events)
        if len(engine.timing.history(cutoff)) < 4:
            continue
        truths = {'train': as_of_truth(engine, TRAIN_END),
                  'validation': as_of_truth(engine, TEST_START), 'test': as_of_truth(engine, cutoff)}
        seen = set()
        end = max(available(e) for e in events)
        for f in engine.timing.fixes:
            now = available(f)
            minute = int(now//60)
            if minute in seen or f['payload'].get('speed', -1) < 2.5:
                continue
            seen.add(minute)
            part = partition(now)
            if part == 'embargo':
                continue
            pred = engine.predict(now)
            if not pred['bracket'] or not pred['moving']:
                continue
            # Fixed candidate generator; model learns whether to emit this prediction.
            sid = pred['sequence'] or pred['route'] or pred['habit']
            if sid is None:
                continue
            engine.timing.truth = truths[part]
            outcomes = {k: engine.outcome(now, station, end) for k, station in pred.items()
                        if k in POLICIES and station is not None}
            outcome, visit = engine.outcome(now, sid, end)
            rows.append(dict(account=account, time=now, partition=part, x=features(engine, now, pred, sid),
                y=int(outcome == 'correct_purchase_station'), outcome=outcome,
                visit=visit['id'] if visit else None, arrival=visit['arrival'] if visit else None,
                station=sid, rules={k: dict(outcome=o, visit=v['id'] if v else None,
                    arrival=v['arrival'] if v else None, station=pred[k]) for k, (o, v) in outcomes.items()}))
        print('Feature replay finished for anonymous account', account, flush=True)
    return sorted(rows, key=lambda r: (r['time'], r['account']))


def alerts(rows, scores=None, threshold=.5, rule=None):
    last = collections.defaultdict(lambda: -math.inf)
    counts = collections.Counter()
    caught, accounts, stations, leads = set(), set(), set(), []
    for i, r in enumerate(rows):
        if rule:
            v = r['rules'].get(rule)
            if v is None:
                continue
        else:
            if scores[i] < threshold:
                continue
            v = r
        if r['time']-last[r['account']] < 1800:
            continue
        last[r['account']] = r['time']
        counts[v['outcome']] += 1
        if v['outcome'] == 'correct_purchase_station':
            caught.add((r['account'], v['visit']))
            accounts.add(r['account'])
            stations.add((r['account'], v['station']))
            leads.append(round((v['arrival']-r['time'])/60, 2))
    n, correct = sum(counts.values()), counts['correct_purchase_station']
    return dict(predictions=n, correct=correct, wrong=n-correct, correct_prediction_rate=correct/n if n else None,
                outcomes=dict(counts), distinct_purchases_caught=len(caught), correct_accounts=len(accounts),
                correct_personal_stations=len(stations), correct_lead_minutes=leads)


def choose_threshold(rows, scores):
    # Validation only. Require actual successes and nonzero coverage.
    options = []
    for threshold in (.1, .2, .3, .4, .5, .6, .7, .8, .9):
        result = alerts(rows, scores, threshold)
        if result['predictions'] >= 3 and result['correct'] >= 2:
            options.append((result['correct_prediction_rate'], result['distinct_purchases_caught'], threshold, result))
    if not options:
        return None, None
    _, _, threshold, result = max(options, key=lambda x: x[:3])
    return threshold, result


def main(base, output, cutoff):
    groups, files = load(base, epoch(cutoff))
    rows = build_rows(groups, epoch(cutoff))
    # Models and per-decision rows can encode private behavior. Never publish them.
    private = base/'route-ml'
    private.mkdir(mode=0o700)
    with (private/'decisions.json').open('x') as f:
        json.dump(rows, f, allow_nan=False)
    (private/'decisions.json').chmod(0o600)
    parts = {p: [r for r in rows if r['partition'] == p] for p in ('train', 'validation', 'test')}
    report = dict(cutoff=cutoff, train_end='2026-10-18T00:00:00Z', test_start='2026-10-22T14:10:00Z',
        sklearn_version=sklearn.__version__, features=FEATURES,
        target='Confirmed purchase at the chosen familiar station within 15 minutes, next observed encounter only. All unanswered or absent outcomes are zero.',
        candidate='Sequence station, else single-point route station, else habitual station; only moving minutes inside the established mileage bracket.',
        limitations=['Exploratory local training; no randomized GPS split, no new-person validation, no probability calibration claim.',
                     'Training answers must be available before Oct18; validation answers before Oct22 cutoff; test answers before final cutoff.',
                     'Outcome windows embargoed at split boundaries. Minute rows are correlated; alert cooldown and distinct purchases are also reported.',
                     'No fuel level or full tank ground truth. Negative class includes missing answers by user scoring convention.',
                     'Candidate rules may have been informed by earlier inspected data; chronological replay is not a pristine independent study.'],
        partitions={p: dict(rows=len(rs), positive_minutes=sum(r['y'] for r in rs),
            accounts=len({r['account'] for r in rs}), positive_accounts=len({r['account'] for r in rs if r['y']}),
            distinct_positive_purchases=len({(r['account'], r['visit']) for r in rs if r['y']})) for p, rs in parts.items()},
        rules={p: {k: alerts(rs, rule=k) for k in POLICIES} for p, rs in parts.items()}, models={})
    train = parts['train']
    if len({r['y'] for r in train}) < 2:
        report['training_failure'] = 'Training partition has fewer than two target classes.'
    else:
        x, y = np.array([r['x'] for r in train]), np.array([r['y'] for r in train])
        models = {'logistic_l2': make_pipeline(StandardScaler(), LogisticRegression(C=.1, class_weight='balanced', max_iter=2000, random_state=27)),
                  'random_forest': RandomForestClassifier(n_estimators=200, max_depth=3, min_samples_leaf=10,
                      class_weight='balanced', random_state=27, n_jobs=2)}
        for name, model in models.items():
            model.fit(x, y)
            model_path = private/(name+'.joblib')
            joblib.dump(model, model_path)
            model_path.chmod(0o600)
            scores = {p: model.predict_proba([r['x'] for r in rs])[:, 1] if rs else np.array([]) for p, rs in parts.items()}
            threshold, val = choose_threshold(parts['validation'], scores['validation'])
            entry = dict(selected_validation_threshold=threshold, selected_validation_alerts=val,
                         model_sha256=hashlib.sha256(model_path.read_bytes()).hexdigest(), evaluation={})
            for p, rs in parts.items():
                labels = [r['y'] for r in rs]
                mixed = len(set(labels)) == 2
                entry['evaluation'][p] = dict(
                    average_precision=float(average_precision_score(labels, scores[p])) if mixed else None,
                    roc_auc=float(roc_auc_score(labels, scores[p])) if mixed else None,
                    positive_prevalence=sum(labels)/len(labels) if labels else None,
                    fixed_threshold_05=alerts(rs, scores[p], .5),
                    validation_selected=alerts(rs, scores[p], threshold) if threshold is not None else None)
            weights = model[-1].coef_[0] if name == 'logistic_l2' else model.feature_importances_
            entry['feature_weights_not_causal_explanations'] = dict(zip(FEATURES, map(float, weights)))
            report['models'][name] = entry
    report['input_sha256'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    report['source_sha256'] = {name: hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest()
                             for name in ('trainRouteModels.py', 'auditRouteWindow.py', 'timingFeatures.py', 'mileageReadiness.py')}
    output.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    print(json.dumps({'partitions': report['partitions'], 'models': {k: v['evaluation']['test'] for k, v in report['models'].items()}}, indent=2))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
