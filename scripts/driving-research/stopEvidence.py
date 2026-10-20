"""Causal stop-prompt gates for offline evaluation; not an enabled app policy.

No label, station identity, future fix, or post-departure pedometer result enters
the gates. Missing motion remains unknown. Times are seconds, distances meters.
"""
import math
import statistics

from backtestAnticipation import available, distance, valid_fix


POLICIES = (
    "v2",
    "continuous_90",
    "continuous_120",
    "stable_90",
    "walking",
    "stable_90_or_walking",
    "stable_90_and_motion",
    "core_50",
    "core_65",
    "core_80",
    "core_50_or_walking",
    "core_65_or_walking",
)


class StopEvidence:
    def __init__(self):
        self.fixes = []
        self.motion = []

    def ingest(self, event):
        if event["kind"] == "location":
            self.fixes.append(event)
        if event["kind"] == "motion":
            self.motion.append((available(event), event["payload"]))
        p = event["payload"]
        if p.get("source") == "apple_motion_history":
            # History can be used only after its response actually arrived.
            for activity in p.get("activities", []):
                self.motion.append((available(event), activity))

    def signals(self, now, start, station):
        # Evaluate a consecutive low-speed tail, not elapsed time between two
        # stationary fixes with driving or a tracking gap in between.
        tail = []
        previous = None
        for e in reversed(self.fixes):
            if available(e) > now:
                continue
            if not valid_fix(e):
                break
            p = e["payload"]
            t = p["timestamp"]
            if t < start or now - t > 180:
                break
            if previous is not None and previous - t > 45:
                break
            if not 0 <= p["speed"] <= 1.0:
                break
            if distance((p["latitude"], p["longitude"]), station) + p["accuracy"] > 110:
                break
            if previous is None or t < previous:
                tail.append(p)
                previous = t
        span = tail[0]["timestamp"] - tail[-1]["timestamp"] if tail else 0
        fresh = bool(tail) and 0 <= now - tail[0]["timestamp"] <= 30
        # Subtract both uncertainty radii; jitter alone must not veto a stop.
        excursion = max((
            distance((a["latitude"], a["longitude"]), (b["latitude"], b["longitude"]))
            - a["accuracy"] - b["accuracy"]
            for a in tail for b in tail
        ), default=math.inf)
        recent = [(p["timestamp"], known, p) for known, p in self.motion
                  if known <= now and start <= p.get("timestamp", math.inf) <= now
                  and now - p["timestamp"] <= 90 and p.get("confidence", 0) >= 1]
        motion = max(recent, key=lambda v: (v[0], v[1]))[2] if recent else {}
        walking = motion.get("walking") is True and motion.get("automotive") is not True
        stationary = motion.get("stationary") is True and motion.get("automotive") is not True
        continuous90 = fresh and len(tail) >= 4 and span >= 90
        # Exploratory second-stage candidates. Require a recent minute of
        # coverage and use uncertainty-expanded distance, not a single GPS point.
        core = {}
        for e in self.fixes:
            p = e["payload"]
            if (available(e) <= now and valid_fix(e)
                    and max(start, now - 60) <= p["timestamp"] <= now):
                core[p["timestamp"]] = p
        times = sorted(core)
        core_ready = (len(times) >= 3 and times[-1] - times[0] >= 30
                      and now - times[-1] <= 30)
        core_distance = statistics.median(
            distance((p["latitude"], p["longitude"]), station) + p["accuracy"]
            for p in core.values()
        ) if core_ready else math.inf
        return {
            "continuous_90": continuous90,
            "continuous_120": fresh and len(tail) >= 5 and span >= 120,
            "stable_90": continuous90 and excursion <= 20,
            "walking": walking,
            "motion_support": walking or stationary,
            "core_distance": core_distance,
        }

    def decisions(self, now, start, station):
        s = self.signals(now, start, station)
        return {
            "v2": True,
            "continuous_90": s["continuous_90"],
            "continuous_120": s["continuous_120"],
            "stable_90": s["stable_90"],
            "walking": s["walking"],
            "stable_90_or_walking": s["stable_90"] or s["walking"],
            "stable_90_and_motion": s["stable_90"] and s["motion_support"],
            "core_50": s["core_distance"] <= 50,
            "core_65": s["core_distance"] <= 65,
            "core_80": s["core_distance"] <= 80,
            "core_50_or_walking": s["core_distance"] <= 50 or s["walking"],
            "core_65_or_walking": s["core_distance"] <= 65 or s["walking"],
        }
