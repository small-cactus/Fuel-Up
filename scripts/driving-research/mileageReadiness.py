"""Mileage-only forecasts from confirmed fills and captured GPS travel.

Timestamps order evidence and validate GPS segments; elapsed time, time of day,
station preference, and slowing down never change the mileage forecast.
Captured distance is not an odometer reading or a fuel-level measurement.
"""
import math
import statistics

KM_PER_MILE = 1.609344


class MileageReadiness:
    def __init__(self, timing):
        self.timing = timing

    def snapshot(self, cutoff, minimum_cycles=1, rule='last_three_median'):
        if rule not in ('last_three_median', 'last_interval'):
            raise ValueError('Unknown mileage forecast rule')
        history = self.timing.history(cutoff)
        cycles = []
        for start, end in zip(history, history[1:]):
            miles = (self.timing.totals(end['arrival'])[0]
                     - self.timing.totals(start['arrival'])[0]) / KM_PER_MILE
            # A zero captured interval is missing travel evidence, not a tiny tank.
            if miles > 0:
                cycles.append(miles)
        recent = cycles[-3:] if rule == 'last_three_median' else cycles[-1:]
        typical = statistics.median(recent) if len(cycles) >= minimum_cycles and recent else math.nan
        since = ((self.timing.totals(cutoff)[0]
                  - self.timing.totals(history[-1]['arrival'])[0]) / KM_PER_MILE
                 if history else math.nan)
        return dict(
            known_confirmed_fills=len(history), known_mileage_cycles=len(cycles),
            last_fill_id=history[-1]['id'] if history else None,
            observed_miles_since_fill=since, typical_observed_fill_miles=typical,
            predicted_miles_remaining=typical - since,
            mileage_due_ratio=since / typical if typical > 0 else math.nan,
            recent_cycle_min_miles=min(recent) if recent else math.nan,
            recent_cycle_max_miles=max(recent) if recent else math.nan,
        )


def ready(snapshot, lead_miles=10):
    """Readiness only; the caller deduplicates alerts until a new confirmed fill."""
    remaining = snapshot['predicted_miles_remaining']
    return math.isfinite(remaining) and remaining <= lead_miles
