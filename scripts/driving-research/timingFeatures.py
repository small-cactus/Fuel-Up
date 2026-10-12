"""Causal timing features. Station identities and geometry are not model inputs."""
import bisect
import statistics

from backtestAnticipation import available, distance, valid_fix


class TimingFeatures:
    def __init__(self, events):
        self.events = sorted(events, key=lambda e: (available(e), e['id']))
        self.fixes = [e for e in self.events if e['kind'] == 'location' and valid_fix(e)]
        self.times = [available(e) for e in self.fixes]
        self.distance_km = []
        self.driving_hours = []
        km = hours = 0
        previous = None
        for e in self.fixes:
            p = e['payload']
            if previous:
                q = previous['payload']
                dt = p['timestamp'] - q['timestamp']
                meters = distance((p['latitude'], p['longitude']), (q['latitude'], q['longitude']))
                if 0 < dt <= 120 and meters / dt <= 70 and max(p.get('speed', -1), q.get('speed', -1)) >= 2.5:
                    km += meters / 1000
                    hours += dt / 3600
            self.distance_km.append(km)
            self.driving_hours.append(hours)
            previous = e

        self.visits = {}
        self.labels = []
        self.movement_starts = []
        last_movement = None
        for e in self.events:
            p = e['payload']
            t = available(e)
            if e['kind'] == 'visit_observation':
                # Coordinates and station ID deliberately discarded here.
                self.visits.setdefault(p['visitId'], {'id': p['visitId'], 'arrival': p['startedAt'], 'known_at': t})
            elif e['kind'] == 'visit_label':
                self.labels.append((t, p['visitId'], p['label']))
            moving = (e['kind'] == 'location' and valid_fix(e) and p.get('speed', -1) >= 2.5)
            moving |= (e['kind'] == 'motion' and p.get('automotive') and not p.get('stationary')
                       and p.get('confidence', 0) >= 1 and 0 <= t - p['timestamp'] <= 120)
            if moving:
                if last_movement is not None and t - last_movement >= 900:
                    self.movement_starts.append(t)
                last_movement = t
        self.truth = {vid: value for _, vid, value in self.labels}

    def totals(self, t):
        i = bisect.bisect_right(self.times, t) - 1
        return (self.distance_km[i], self.driving_hours[i]) if i >= 0 else (0, 0)

    def fix(self, t):
        i = bisect.bisect_right(self.times, t) - 1
        if i < 0:
            return None
        e = self.fixes[i]
        return e if 0 <= t - e['payload']['timestamp'] <= 120 else None

    def history(self, t):
        labels = {}
        for known, vid, value in self.labels:
            if known > t:
                break
            labels[vid] = value
        return sorted((v for vid, v in self.visits.items()
                       if labels.get(vid) == 'fueled' and v['known_at'] <= t and v['arrival'] < t),
                      key=lambda v: v['arrival'])

    def recurring_departure(self, t):
        # Prior days only, so later starts on the current day cannot create a routine.
        prior = [a for a in self.movement_starts if int(a // 86400) < int(t // 86400)]
        soon = [a for a in prior if 300 <= (a - t) % 86400 <= 1200]
        for center in soon:
            days = {int(a // 86400) for a in prior if abs((a - center + 43200) % 86400 - 43200) <= 2700}
            if len(days) >= 3:
                return True
        return False

    def predict(self, t):
        history = self.history(t)
        fix = self.fix(t)
        moving = fix is not None and fix['payload'].get('speed', -1) >= 2.5
        clock = len(history) >= 2 and any(0 <= (v['arrival'] - t) % 86400 <= 3600 for v in history)
        elapsed_due = distance_due = False
        km_since = hours_since = elapsed_hours = None
        if history:
            last = history[-1]['arrival']
            km_since = self.totals(t)[0] - self.totals(last)[0]
            hours_since = self.totals(t)[1] - self.totals(last)[1]
            elapsed_hours = (t - last) / 3600
        if len(history) >= 3:
            intervals = [(b['arrival'] - a['arrival']) / 3600 for a, b in zip(history, history[1:])]
            distances = [self.totals(b['arrival'])[0] - self.totals(a['arrival'])[0]
                         for a, b in zip(history, history[1:])]
            elapsed_due = elapsed_hours >= 0.8 * statistics.median(intervals)
            typical_distance = statistics.median(distances)
            distance_due = typical_distance >= 10 and km_since >= 0.8 * typical_distance
        due = elapsed_due or distance_due
        return {
            'history_count': len(history), 'fresh_fix': fix is not None, 'moving': moving,
            'observed_km_since_fuel': km_since, 'observed_driving_hours_since_fuel': hours_since,
            'elapsed_hours_since_fuel': elapsed_hours,
            'clock': clock, 'elapsed_cycle': moving and elapsed_due,
            'driving_cycle': moving and distance_due,
            'clock_and_cycle': moving and clock and due,
            'before_departure': not moving and clock and due and self.recurring_departure(t),
        }
