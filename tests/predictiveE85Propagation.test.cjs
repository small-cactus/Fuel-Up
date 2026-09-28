const test = require('node:test');
const assert = require('node:assert/strict');
const { createPredictiveFuelingRuntime } = require('../src/lib/predictiveFuelingRuntime');
const { refreshFuelPriceSnapshotAlongTrajectory } = require('../src/services/fuel');

test('runtime carries E85 availability to both trajectory fetches without replacing premium grade, and preference changes invalidate cooldown', async () => {
  const queries = [];
  const runtime = createPredictiveFuelingRuntime({
    preferences: { preferredOctane: 'premium', requiresE85: true },
    loadStateAsync: async () => ({}), loadProfileAsync: async () => ({}),
    saveStateAsync: async value => value, saveProfileAsync: async value => value,
    createRecommender: () => ({ setStations() {}, setProfile() {}, pushLocation() {}, getPendingRecommendation() { return null; } }),
    prefetchSnapshot: input => refreshFuelPriceSnapshotAlongTrajectory({
      ...input,
      routeProvider: async () => ({ distanceMeters: 18000, coordinates: [
        { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.06 },
        { latitude: 0, longitude: 0.12 }, { latitude: 0, longitude: 0.16 },
      ], steps: [{ instructions: 'Continue straight' }] }),
      snapshotFetcher: async query => { queries.push(query); return { snapshot: { topStations: [], quotes: [] } }; },
      cacheWriter: async () => {},
    }),
  });
  const payload = { locations: [{ coords: { latitude: 0, longitude: 0, heading: 90, speed: 21 }, timestamp: 1700000000000 }] };
  await runtime.processLocationPayload(payload);
  assert.equal(queries.length, 2);
  assert.ok(queries.every(query => query.fuelType === 'premium' && query.requiresE85 === true));
  await runtime.processLocationPayload(payload);
  assert.equal(queries.length, 2, 'same preference uses existing cooldown');
  await runtime.updateConfig({ preferences: { requiresE85: false } });
  await runtime.processLocationPayload(payload);
  assert.equal(queries.length, 4, 'changed availability criterion bypasses old cooldown');
  assert.ok(queries.slice(2).every(query => query.fuelType === 'premium' && query.requiresE85 === false));
});
