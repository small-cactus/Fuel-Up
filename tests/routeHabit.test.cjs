const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeRouteHabitShareForKeys,
  computeRouteStationObservedMetricsForKeys,
} = require('../src/lib/routeHabit.js');

test('route habit share rewards broad agreement across route habit keys', () => {
  const nowMs = new Date('2026-04-16T10:00:00-04:00').getTime();
  const routeHabitKeys = [
    'template:weekday-commute',
    'purpose_scenario:commute:city',
    'purpose:commute',
  ];

  const routeStationHabits = {
    'template:weekday-commute': {
      target: { count: 12, lastVisitMs: nowMs - 86_400_000 },
      other: { count: 1, lastVisitMs: nowMs - 86_400_000 },
    },
    'purpose_scenario:commute:city': {
      target: { count: 8, lastVisitMs: nowMs - 86_400_000 },
      other: { count: 3, lastVisitMs: nowMs - 86_400_000 },
    },
    'purpose:commute': {
      target: { count: 10, lastVisitMs: nowMs - 86_400_000 },
      other: { count: 4, lastVisitMs: nowMs - 86_400_000 },
    },
  };

  const share = computeRouteHabitShareForKeys(routeStationHabits, routeHabitKeys, 'target', nowMs);
  assert.ok(share >= 0.65, `expected strong broad route-habit support, got ${share}`);
});

test('route habit share does not over-credit a station from one narrow key alone', () => {
  const nowMs = new Date('2026-04-16T10:00:00-04:00').getTime();
  const routeHabitKeys = [
    'template:weekday-commute',
    'purpose_scenario:commute:city',
    'purpose:commute',
  ];

  const routeStationHabits = {
    'template:weekday-commute': {
      target: { count: 12, lastVisitMs: nowMs - 86_400_000 },
      other: { count: 1, lastVisitMs: nowMs - 86_400_000 },
    },
  };

  const share = computeRouteHabitShareForKeys(routeStationHabits, routeHabitKeys, 'target', nowMs);
  assert.ok(share <= 0.40, `expected narrow template-only support to stay bounded, got ${share}`);
});

test('route observed metrics distinguish repeated route exposure from true route conversion', () => {
  const nowMs = new Date('2026-04-16T10:00:00-04:00').getTime();
  const routeHabitKeys = [
    'template:weekday-commute',
    'purpose_scenario:commute:city',
    'purpose:commute',
  ];

  const routeStationHabits = {
    'template:weekday-commute': {
      target: { count: 2, lastVisitMs: nowMs - 86_400_000 },
    },
    'purpose_scenario:commute:city': {
      target: { count: 3, lastVisitMs: nowMs - 86_400_000 },
    },
    'purpose:commute': {
      target: { count: 3, lastVisitMs: nowMs - 86_400_000 },
    },
  };
  const routeStationExposures = {
    'template:weekday-commute': {
      target: { count: 12, lastExposureMs: nowMs - 86_400_000 },
      other: { count: 3, lastExposureMs: nowMs - 86_400_000 },
    },
    'purpose_scenario:commute:city': {
      target: { count: 15, lastExposureMs: nowMs - 86_400_000 },
      other: { count: 4, lastExposureMs: nowMs - 86_400_000 },
    },
    'purpose:commute': {
      target: { count: 16, lastExposureMs: nowMs - 86_400_000 },
      other: { count: 5, lastExposureMs: nowMs - 86_400_000 },
    },
  };

  const metrics = computeRouteStationObservedMetricsForKeys(
    routeStationHabits,
    routeStationExposures,
    routeHabitKeys,
    'target',
    nowMs,
  );

  assert.ok(metrics.reliability >= 0.9, `expected strong route exposure reliability, got ${metrics.reliability}`);
  assert.ok(metrics.conversionRate < 0.25, `expected low route conversion for repeated pass-by behavior, got ${metrics.conversionRate}`);
  assert.ok(metrics.skipScore > 0.45, `expected elevated route skip score for repeated no-stop exposure, got ${metrics.skipScore}`);
});
