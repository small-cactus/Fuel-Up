"""Exploratory habitual-stop inference. Never converts a guess into a user label.

A substantial station encounter may be a likely purchase after two previous
confirmed purchases at that station, provided no previous explicit negative is
known there. Uses the existing detector's station association, not pump geometry.
This is retrospective research code, not an enabled application feature.
"""
import collections
from backtestAnticipation import available


def infer(events):
    events = sorted(events, key=lambda e: (available(e), e['id']))
    truth = {e['payload']['visitId']: e for e in events if e['kind'] == 'visit_label'}
    observations = {}
    labels = {}
    tested = set()
    predictions = []
    counts = collections.Counter()
    for event in events:
        p = event['payload']
        vid = p.get('visitId')
        now = available(event)
        if event['kind'] == 'visit_label':
            labels[vid] = p['label']
        if event['kind'] not in ('visit_observation', 'visit_candidate', 'visit_departure', 'visit_gap'):
            continue
        observations.setdefault(vid, p)
        if (vid in tested or p.get('samples', 0) < 3
                or p.get('lastInsideAt', p['startedAt'])-p['startedAt'] < 180):
            continue
        tested.add(vid)
        if vid in labels:
            counts['already_answered_at_eligibility'] += 1
            continue
        counts['unanswered_at_eligibility'] += 1
        previous = [labels[q] for q, v in observations.items() if q != vid
                    and v['startedAt'] < p['startedAt'] and str(v['stationId']) == str(p['stationId'])
                    and q in labels]
        positives = previous.count('fueled')
        negatives = sum(a in ('not_fueling', 'not_a_stop') for a in previous)
        if positives < 2 or negatives:
            continue
        # Future answers score this prediction only. They never change eligibility.
        answer = truth.get(vid)
        predictions.append(dict(visit=vid, arrival=p['startedAt'], known_at=now,
            prior_confirmed_purchases=positives,
            later_answer=answer['payload']['label'] if answer else 'unanswered',
            lead_before_answer_minutes=(available(answer)-now)/60 if answer else None,
            delay_after_arrival_seconds=now-p['startedAt']))
    report = dict(**counts, predictions=len(predictions),
        outcomes=dict(collections.Counter(p['later_answer'] for p in predictions)),
        details=[{k: v for k, v in p.items() if k not in ('visit', 'arrival', 'known_at')} for p in predictions])
    return predictions, report
