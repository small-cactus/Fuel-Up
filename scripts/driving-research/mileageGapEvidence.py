"""Separate measurable mileage gaps from gaps with automotive motion evidence.

Recovered motion is available only after every response chunk was received.
An automotive classification is a tracking-risk flag, not a distance estimate.
No query prefix before its first activity transition is filled in.
"""
import collections
import math
from backtestAnticipation import available


def history_segments(events):
    queries = collections.defaultdict(dict)
    for e in events:
        p = e['payload']
        if p.get('source') == 'apple_motion_history' and p.get('status') == 'available':
            key = p['queryStartAt'], p['queryEndAt'], p['chunkCount']
            previous = queries[key].get(p['chunkIndex'])
            if previous is None or available(e) < available(previous):
                queries[key][p['chunkIndex']] = e
    segments = []
    complete = 0
    for (start, end, count), chunks in queries.items():
        if set(chunks) != set(range(count)):
            continue
        known = max(available(e) for e in chunks.values())
        if start > end or end > known:
            continue
        complete += 1
        activities = {a['timestamp']: a for e in chunks.values() for a in e['payload']['activities']
                      if start <= a['timestamp'] <= end}
        times = sorted(activities)
        for i, t in enumerate(times):
            a = activities[t]
            stop = times[i+1] if i+1 < len(times) else end
            if stop <= t or a.get('confidence', 0) < 1:
                continue
            state = ('automotive' if a.get('automotive') and not a.get('stationary')
                     else 'stationary' if a.get('stationary') and not a.get('automotive') else 'other')
            segments.append(dict(start=t, end=stop, known=known, state=state))
    return segments, dict(queries=len(queries), complete_queries=complete)


def gap_windows(events):
    previous = None
    gaps = []
    increments = 0
    for e in sorted(events, key=lambda e: (available(e), e['id'])):
        m = e['payload'].get('mileageAtReceipt')
        if not m:
            continue
        if previous and m['epoch'] == previous['epoch'] and m['gapCount'] > previous['gapCount']:
            increments += m['gapCount']-previous['gapCount']
            if (m['collectionBoundaryCount'] == previous['collectionBoundaryCount']
                    and m['gapCount']-previous['gapCount'] == 1
                    and m['acceptedSamples']-previous['acceptedSamples'] == 1
                    and 'lastSampleAt' in m and 'lastSampleAt' in previous
                    and abs((m['lastSampleAt']-previous['lastSampleAt']) -
                            (m['unmeasuredGapSeconds']-previous['unmeasuredGapSeconds'])) < .01):
                gaps.append(dict(start=previous['lastSampleAt'], end=m['lastSampleAt'],
                                 known=available(e), epoch=m['epoch']))
        previous = m
    return gaps, increments


def covered_seconds(intervals):
    total = 0
    end = -math.inf
    for a, b in sorted(intervals):
        total += max(0, b-max(a, end))
        end = max(end, b)
    return total


def evidence(events):
    segments, query_counts = history_segments(events)
    gaps, increments = gap_windows(events)
    risks = []
    counts = collections.Counter()
    for g in gaps:
        # Avoid treating a drive-to-park or wake-to-drive transition near either
        # GPS endpoint as strong evidence of an unmeasured middle-of-gap drive.
        lo, hi = g['start']+120, g['end']-120
        if hi-lo < 60:
            counts['too_short_for_interior_check'] += 1
            continue
        counts['interior_checkable'] += 1
        overlapping = [s for s in segments if max(lo, s['start']) < min(hi, s['end'])]
        automotive = [s for s in overlapping if s['state'] == 'automotive']
        first_known = None
        for at in sorted({s['known'] for s in automotive}):
            intervals = [(max(lo, s['start']), min(hi, s['end'])) for s in automotive if s['known'] <= at]
            if covered_seconds(intervals) >= 60:
                first_known = max(g['known'], at)
                break
        if first_known is not None:
            counts['automotive_interior_at_least_60_seconds'] += 1
            risks.append(dict(start=g['start'], end=g['end'], known=first_known, epoch=g['epoch']))
        stationary = [(max(lo, s['start']), min(hi, s['end'])) for s in overlapping if s['state'] == 'stationary']
        if not automotive and covered_seconds(stationary) >= hi-lo-.01:
            counts['fully_stationary_classified_interior'] += 1
        if not overlapping:
            counts['no_classified_history_interior'] += 1
    return risks, dict(recorded_gap_increments=increments, exact_gap_windows=len(gaps),
                       **query_counts, **counts)
