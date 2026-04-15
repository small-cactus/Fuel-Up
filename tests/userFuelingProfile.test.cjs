const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROFILE_PRESETS,
  computeProfileBonus,
  computeContextualHistoryScore,
  computeContextualObservedConversionRate,
  computeExposureContextMatch,
  computeHistoryScore,
  computeObservedConversionRate,
  computeObservedSkipScore,
  isRushHour,
} = require('../src/lib/userFuelingProfile.js');

test('PROFILE_PRESETS has all 4 expected profiles', () => {
  assert.ok('cheapest' in PROFILE_PRESETS);
  assert.ok('nearest' in PROFILE_PRESETS);
  assert.ok('brand_loyal' in PROFILE_PRESETS);
  assert.ok('balanced' in PROFILE_PRESETS);
});

test('brand_loyal profile gives higher bonus to Shell than Maverik', () => {
  const profile = PROFILE_PRESETS.brand_loyal;
  const shellStation = { stationId: 'shell-1', brand: 'Shell', price: 3.59, distanceMiles: 0.5 };
  const maverikStation = { stationId: 'mav-1', brand: 'Maverik', price: 3.29, distanceMiles: 0.3 };
  const allStations = [shellStation, maverikStation];
  const shellBonus = computeProfileBonus(shellStation, profile, allStations);
  const maverikBonus = computeProfileBonus(maverikStation, profile, allStations);
  assert.ok(shellBonus > maverikBonus, `Shell bonus (${shellBonus}) should exceed Maverik bonus (${maverikBonus})`);
});

test('cheapest profile gives higher bonus to lower-priced station', () => {
  const profile = PROFILE_PRESETS.cheapest;
  const cheapStation = { stationId: 'cheap', brand: 'Costco', price: 3.05, distanceMiles: 2.0 };
  const expensiveStation = { stationId: 'exp', brand: 'Shell', price: 3.59, distanceMiles: 0.3 };
  const cheapBonus = computeProfileBonus(cheapStation, profile, [cheapStation, expensiveStation]);
  const expensiveBonus = computeProfileBonus(expensiveStation, profile, [cheapStation, expensiveStation]);
  assert.ok(cheapBonus > expensiveBonus, `cheap station (${cheapBonus}) should beat expensive (${expensiveBonus})`);
});

test('visit history increases bonus for frequently visited station', () => {
  const profile = { ...PROFILE_PRESETS.balanced, visitHistory: [
    { stationId: 'fav-station', visitCount: 15, lastVisitMs: Date.now() - 2 * 86400 * 1000 }
  ]};
  const favStation = { stationId: 'fav-station', brand: 'Shell', price: 3.40, distanceMiles: 1.0 };
  const newStation = { stationId: 'new-station', brand: 'Shell', price: 3.40, distanceMiles: 1.0 };
  const favBonus = computeProfileBonus(favStation, profile, [favStation, newStation]);
  const newBonus = computeProfileBonus(newStation, profile, [favStation, newStation]);
  assert.ok(favBonus > newBonus, `favorite station (${favBonus}) should score higher than new (${newBonus})`);
});

test('isRushHour returns true for morning peak weekday', () => {
  // 8am on a Monday
  const monday8am = new Date();
  monday8am.setDate(monday8am.getDate() - (monday8am.getDay() - 1 + 7) % 7); // prev/next Monday
  monday8am.setHours(8, 0, 0, 0);
  const profile = PROFILE_PRESETS.nearest; // has morningPeak: true
  assert.ok(isRushHour(profile, monday8am.getTime()));
});

test('isRushHour returns false on weekend', () => {
  // Saturday at 8am
  const saturday = new Date();
  saturday.setDate(saturday.getDate() - (saturday.getDay() - 6 + 7) % 7);
  saturday.setHours(8, 0, 0, 0);
  const profile = PROFILE_PRESETS.nearest;
  assert.ok(!isRushHour(profile, saturday.getTime()));
});

test('contextual history dampens generic habit when the drive context does not match', () => {
  const now = Date.UTC(2026, 3, 15, 8, 0, 0);
  const profile = {
    ...PROFILE_PRESETS.balanced,
    visitHistory: [
      {
        stationId: 'fav-station',
        visitCount: 10,
        lastVisitMs: now - (2 * 86_400_000),
        visitTimestamps: [
          now - (2 * 86_400_000),
          now - (9 * 86_400_000),
          now - (16 * 86_400_000),
        ],
        contextCounts: {
          total: 10,
          highway: 10,
          suburban: 0,
          city: 0,
          city_grid: 0,
          weekday: 10,
          weekend: 0,
          morning: 10,
          midday: 0,
          evening: 0,
          night: 0,
        },
      },
    ],
  };
  const station = { stationId: 'fav-station' };
  const generic = computeHistoryScore(station, profile, now);
  const highwayContext = computeContextualHistoryScore(station, profile, now, {
    isHighwayCruise: true,
    meanSpeedMps: 25,
  });
  const cityContext = computeContextualHistoryScore(station, profile, now, {
    isHighwayCruise: false,
    isCityGridLike: true,
    meanSpeedMps: 5,
  });

  assert.ok(highwayContext <= generic, 'contextual history should never exceed generic history');
  assert.ok(highwayContext > cityContext, `expected matching highway context (${highwayContext}) to beat mismatched city context (${cityContext})`);
});

test('observed conversion and skip scores distinguish frequent pass-by stations from true habitual stops', () => {
  const now = Date.UTC(2026, 3, 15, 8, 0, 0);
  const profile = {
    ...PROFILE_PRESETS.balanced,
    visitHistory: [
      {
        stationId: 'habit-station',
        visitCount: 6,
        lastVisitMs: now - (2 * 86_400_000),
        visitTimestamps: [now - (2 * 86_400_000), now - (9 * 86_400_000)],
        contextCounts: {
          total: 6,
          highway: 0,
          suburban: 0,
          city: 6,
          city_grid: 0,
          weekday: 6,
          weekend: 0,
          morning: 6,
          midday: 0,
          evening: 0,
          night: 0,
        },
      },
    ],
    exposureHistory: [
      {
        stationId: 'habit-station',
        exposureCount: 8,
        lastExposureMs: now - 86_400_000,
        contextCounts: {
          total: 8,
          highway: 0,
          suburban: 0,
          city: 8,
          city_grid: 0,
          weekday: 8,
          weekend: 0,
          morning: 8,
          midday: 0,
          evening: 0,
          night: 0,
        },
      },
      {
        stationId: 'pass-by-station',
        exposureCount: 12,
        lastExposureMs: now - 86_400_000,
        contextCounts: {
          total: 12,
          highway: 0,
          suburban: 0,
          city: 12,
          city_grid: 0,
          weekday: 12,
          weekend: 0,
          morning: 12,
          midday: 0,
          evening: 0,
          night: 0,
        },
      },
    ],
  };

  const context = {
    isHighwayCruise: false,
    meanSpeedMps: 9,
  };
  const habitStation = { stationId: 'habit-station' };
  const passByStation = { stationId: 'pass-by-station' };

  const habitConversion = computeObservedConversionRate(habitStation, profile);
  const passByConversion = computeObservedConversionRate(passByStation, profile);
  const habitContextConversion = computeContextualObservedConversionRate(habitStation, profile, now, context);
  const passByContextConversion = computeContextualObservedConversionRate(passByStation, profile, now, context);
  const passByExposureMatch = computeExposureContextMatch(passByStation, profile, now, context);
  const habitSkipScore = computeObservedSkipScore(habitStation, profile, now, context);
  const passBySkipScore = computeObservedSkipScore(passByStation, profile, now, context);

  assert.ok(habitConversion > passByConversion, `expected habitual conversion (${habitConversion}) to exceed pass-by conversion (${passByConversion})`);
  assert.ok(habitContextConversion > passByContextConversion, `expected contextual conversion (${habitContextConversion}) to exceed pass-by contextual conversion (${passByContextConversion})`);
  assert.ok(passByExposureMatch > 0.6, `expected pass-by station exposure match to be high, got ${passByExposureMatch}`);
  assert.ok(passBySkipScore > habitSkipScore, `expected pass-by skip score (${passBySkipScore}) to exceed habit skip score (${habitSkipScore})`);
});
