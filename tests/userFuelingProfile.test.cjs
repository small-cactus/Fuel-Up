const test = require('node:test');
const assert = require('node:assert/strict');
const { PROFILE_PRESETS, computeProfileBonus, isRushHour } = require('../src/lib/userFuelingProfile.js');

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
