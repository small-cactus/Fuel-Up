const test = require('node:test');
const assert = require('node:assert/strict');
const { recommend } = require('../src/lib/predictiveRecommender.js');
const { normalizePredictiveFuelingPreferences } = require('../src/lib/predictiveFuelingPreferencesStore.js');
const time = 1700000000000;
const window = Array.from({ length: 8 }, (_, i) => ({ latitude: 39.74, longitude: -105.05 + i * 0.01, speed: 30, timestamp: time - (7 - i) * 30000 }));
const stations = [
  { stationId: 'cheap', stationName: 'Cheap', brandNames: ['Cheap'], latitude: 39.74, longitude: -104.955, price: 3 },
  { stationId: 'preferred', stationName: 'Preferred', brandNames: ['Preferred'], latitude: 39.74, longitude: -104.951, price: 3.5 },
];

test('explicit preferred brand wins among viable recommendations without changing prices', () => {
  const before = JSON.stringify(stations);
  const normal = recommend(window, {}, stations, { urgency: 1 });
  const preferred = recommend(window, {}, stations, { urgency: 1, explicitPreferredBrands: [' PREFERRED '] });
  assert.equal(normal.stationId, 'cheap');
  assert.equal(preferred.stationId, 'preferred');
  assert.equal(JSON.stringify(stations), before);
});

test('off-route preferred brand does not block a safe nonpreferred fallback', () => {
  const candidates = [stations[0], { ...stations[1], latitude: 41 }];
  const result = recommend(window, {}, candidates, { urgency: 1, explicitPreferredBrands: ['preferred'] });
  assert.equal(result.stationId, 'cheap');
});

test('brand preference does not bypass stationary-vehicle safety gate', () => {
  const stopped = window.map(sample => ({ ...sample, speed: 0 }));
  assert.equal(recommend(stopped, {}, stations, { urgency: 1, explicitPreferredBrands: ['preferred'] }), null);
});

test('background configuration preserves normalized explicit brands and E85 requirement', () => {
  const prefs = normalizePredictiveFuelingPreferences({ preferredBrands: [' Shell ', 'SHELL', ''], requiresE85: true });
  assert.deepEqual(prefs.preferredBrands, ['shell']);
  assert.equal(prefs.requiresE85, true);
  assert.equal(normalizePredictiveFuelingPreferences().requiresE85, false);
});
