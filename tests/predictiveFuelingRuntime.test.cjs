const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPredictiveFuelingRuntime,
} = require('../src/lib/predictiveFuelingRuntime.js');

function createStation(overrides = {}) {
  return {
    stationId: 'station-1',
    stationName: 'Wawa Route 73',
    brand: 'Wawa',
    latitude: 39.95,
    longitude: -74.99,
    price: 3.19,
    effectivePrice: 3.19,
    routeApproach: {
      alongRouteDistanceMeters: 1800,
      offsetFromRouteMeters: 40,
      sideOfRoad: 'right',
      maneuverPenaltyPrice: 0,
      nextStepDirections: ['right'],
      isOnRoute: true,
    },
    ...overrides,
  };
}

function createRecommendation(overrides = {}) {
  return {
    stationId: 'station-1',
    type: 'cheaper_alternative',
    confidence: 0.81,
    reason: 'Cheaper stop ahead',
    forwardDistance: 1800,
    savings: 0.24,
    stationSide: 'right',
    presentation: {
      surfaceNow: false,
      attentionState: 'high_demand_drive',
      noticeabilityScore: 0.41,
    },
    ...overrides,
  };
}

function createRuntimeHarness({
  pendingRecommendation = null,
  triggeredEvents = [],
  station = createStation(),
}) {
  let nowMs = 1_700_000_000_000;
  let currentPendingRecommendation = pendingRecommendation;
  const savedStates = [];
  const savedProfiles = [];
  const notificationCalls = [];
  const geofenceCalls = [];
  const liveActivityCalls = [];
  const liveActivityHandle = { id: 'live-1' };

  const fakeRecommender = {
    setStations: () => {},
    setProfile: () => {},
    pushLocation: () => triggeredEvents.shift() || null,
    getPendingRecommendation: () => currentPendingRecommendation,
  };

  const runtime = createPredictiveFuelingRuntime({
    now: () => nowMs,
    preferences: {
      searchRadiusMiles: 10,
      preferredOctane: 'regular',
      preferredProvider: 'gasbuddy',
      navigationApp: 'apple-maps',
    },
    loadStateAsync: async () => ({}),
    saveStateAsync: async (state) => {
      savedStates.push(state);
      return state;
    },
    loadProfileAsync: async () => ({
      estimatedMilesSinceLastFill: 140,
      odometerMiles: 40_140,
      visitHistory: [],
      fillUpHistory: [],
    }),
    saveProfileAsync: async (profile) => {
      savedProfiles.push(profile);
      return profile;
    },
    createPrefetchController: () => ({
      handleLocationPayload: async () => ({
        result: {
          snapshot: {
            topStations: [station],
          },
        },
      }),
    }),
    createRecommender: () => fakeRecommender,
    prefetchSnapshot: async () => ({
      snapshot: {
        topStations: [station],
      },
    }),
    syncGeofences: async (regions) => {
      geofenceCalls.push(regions);
    },
    notifications: {
      startPredictiveLiveActivity: (props) => {
        liveActivityCalls.push({ type: 'start', props });
        return liveActivityHandle;
      },
      updatePredictiveLiveActivity: (_instance, props) => {
        liveActivityCalls.push({ type: 'update', props });
      },
      endLiveActivity: () => {
        liveActivityCalls.push({ type: 'end' });
      },
      schedulePredictiveRecommendationNotification: async (payload) => {
        notificationCalls.push(payload);
      },
      openNavigationForStation: async () => true,
    },
  });

  return {
    advanceNow(ms) {
      nowMs += ms;
    },
    geofenceCalls,
    liveActivityCalls,
    notificationCalls,
    runtime,
    savedProfiles,
    savedStates,
    setPendingRecommendation(nextPendingRecommendation) {
      currentPendingRecommendation = nextPendingRecommendation;
    },
  };
}

test('pending recommendation focuses the live activity and geofences without notifying yet', async () => {
  const harness = createRuntimeHarness({
    pendingRecommendation: createRecommendation(),
  });

  await harness.runtime.processLocationPayload({
    locations: [
      {
        coords: {
          latitude: 39.94,
          longitude: -75.02,
          speed: 14,
          heading: 90,
          timestamp: 1_700_000_000_000,
        },
      },
    ],
  });

  assert.equal(harness.notificationCalls.length, 0);
  assert.equal(harness.liveActivityCalls[0].type, 'start');
  assert.equal(harness.liveActivityCalls[0].props.stationName, 'Wawa Route 73');
  assert.equal(harness.geofenceCalls.length, 1);
  assert.equal(harness.geofenceCalls[0][0].identifier, 'fuelup-station:station-1:focus');
  assert.equal(harness.savedStates.at(-1).pendingRecommendation.stationId, 'station-1');
});

test('triggered recommendation sends a single actionable notification and marks the recommendation active', async () => {
  const harness = createRuntimeHarness({
    triggeredEvents: [
      createRecommendation({
        presentation: {
          surfaceNow: true,
          attentionState: 'traffic_light_pause',
          noticeabilityScore: 0.92,
        },
        triggeredAt: 1_700_000_000_000,
      }),
    ],
  });

  await harness.runtime.processLocationPayload({
    locations: [
      {
        coords: {
          latitude: 39.94,
          longitude: -75.02,
          speed: 0.3,
          heading: 90,
          timestamp: 1_700_000_000_000,
        },
      },
    ],
  });

  assert.equal(harness.notificationCalls.length, 1);
  assert.match(harness.notificationCalls[0].title, /\$0\.24\/gal cheaper/);
  assert.equal(harness.savedStates.at(-1).activeRecommendation.stationId, 'station-1');
  assert.equal(harness.savedStates.at(-1).pendingRecommendation, null);
});

test('live activity does not start when ETA would require a fabricated fallback speed', async () => {
  const harness = createRuntimeHarness({
    pendingRecommendation: createRecommendation(),
  });

  await harness.runtime.processLocationPayload({
    locations: [
      {
        coords: {
          latitude: 39.94,
          longitude: -75.02,
          speed: 0.1,
          heading: 90,
          timestamp: 1_700_000_000_000,
        },
      },
    ],
  });

  assert.equal(harness.liveActivityCalls.length, 0);
  assert.equal(harness.savedStates.at(-1).pendingRecommendation.stationId, 'station-1');
});

test('geofence dwell records a station visit and inferred fuel stop, then clears the active focus', async () => {
  const harness = createRuntimeHarness({
    triggeredEvents: [
      createRecommendation({
        presentation: {
          surfaceNow: true,
          attentionState: 'traffic_light_pause',
          noticeabilityScore: 0.9,
        },
      }),
    ],
  });

  await harness.runtime.processLocationPayload({
    locations: [
      {
        coords: {
          latitude: 39.94,
          longitude: -75.02,
          speed: 12,
          heading: 90,
          timestamp: 1_700_000_000_000,
        },
      },
    ],
  });
  await harness.runtime.processGeofenceEvent({
    eventType: 1,
    region: {
      identifier: 'fuelup-station:station-1:focus',
    },
  });
  harness.advanceNow(5 * 60 * 1000);
  await harness.runtime.processGeofenceEvent({
    eventType: 2,
    region: {
      identifier: 'fuelup-station:station-1:focus',
    },
  });

  const savedProfile = harness.savedProfiles.at(-1);
  const savedState = harness.savedStates.at(-1);

  assert.equal(savedProfile.visitHistory.length, 1);
  assert.equal(savedProfile.fillUpHistory.length, 1);
  assert.equal(savedProfile.estimatedMilesSinceLastFill, 0);
  assert.equal(savedState.activeRecommendation, null);
  assert.equal(savedState.pendingRecommendation, null);
  assert.equal(harness.liveActivityCalls.at(-1).type, 'end');
});

test('shutdown clears live activity state, geofences, and ephemeral recommendation context', async () => {
  const harness = createRuntimeHarness({
    pendingRecommendation: createRecommendation(),
  });

  await harness.runtime.processLocationPayload({
    locations: [
      {
        coords: {
          latitude: 39.94,
          longitude: -75.02,
          speed: 12,
          heading: 90,
          timestamp: 1_700_000_000_000,
        },
      },
    ],
  });

  await harness.runtime.shutdown();

  const savedState = harness.savedStates.at(-1);
  assert.deepEqual(harness.geofenceCalls.at(-1), []);
  assert.equal(savedState.pendingRecommendation, null);
  assert.equal(savedState.activeRecommendation, null);
  assert.equal(savedState.geofences.length, 0);
  assert.equal(savedState.recentSamples.length, 0);
  assert.equal(savedState.knownStations.length, 0);
  assert.equal(harness.liveActivityCalls.at(-1).type, 'end');
});

test('resetAllData restores default predictive profile and runtime state', async () => {
  const harness = createRuntimeHarness({
    pendingRecommendation: createRecommendation(),
  });

  await harness.runtime.processLocationPayload({
    locations: [
      {
        coords: {
          latitude: 39.94,
          longitude: -75.02,
          speed: 12,
          heading: 90,
          timestamp: 1_700_000_000_000,
        },
      },
    ],
  });

  await harness.runtime.resetAllData();

  const savedState = harness.savedStates.at(-1);
  const savedProfile = harness.savedProfiles.at(-1);

  assert.deepEqual(harness.geofenceCalls.at(-1), []);
  assert.equal(harness.liveActivityCalls.at(-1).type, 'end');
  assert.equal(savedState.pendingRecommendation, null);
  assert.equal(savedState.activeRecommendation, null);
  assert.equal(savedState.recentSamples.length, 0);
  assert.equal(savedState.knownStations.length, 0);
  assert.equal(savedState.geofences.length, 0);
  assert.equal(savedState.arrivalSession, null);
  assert.equal(savedState.lastNotificationAt, null);
  assert.equal(savedProfile.visitHistory.length, 0);
  assert.equal(savedProfile.fillUpHistory.length, 0);
  assert.equal(savedProfile.estimatedMilesSinceLastFill, null);
  assert.equal(savedProfile.odometerMiles, null);
  assert.deepEqual(savedProfile.preferredBrands, []);
});

test('runtime serializes concurrent background location batches', async () => {
  let nowMs = 1_700_000_000_000;
  let inflightCount = 0;
  let maxInflightCount = 0;
  let releaseFirstFetch = null;
  let prefetchCallCount = 0;

  const runtime = createPredictiveFuelingRuntime({
    now: () => nowMs,
    preferences: {
      searchRadiusMiles: 10,
      preferredOctane: 'regular',
      preferredProvider: 'gasbuddy',
      navigationApp: 'apple-maps',
    },
    loadStateAsync: async () => ({}),
    saveStateAsync: async (state) => state,
    loadProfileAsync: async () => ({
      estimatedMilesSinceLastFill: 140,
      odometerMiles: 40_140,
      visitHistory: [],
      fillUpHistory: [],
    }),
    saveProfileAsync: async (profile) => profile,
    createPrefetchController: () => ({
      handleLocationPayload: async () => {
        prefetchCallCount += 1;
        inflightCount += 1;
        maxInflightCount = Math.max(maxInflightCount, inflightCount);

        if (prefetchCallCount === 1) {
          await new Promise(resolve => {
            releaseFirstFetch = resolve;
          });
        }

        inflightCount -= 1;
        return {
          result: {
            snapshot: {
              topStations: [createStation()],
            },
          },
        };
      },
    }),
    createRecommender: () => ({
      setStations: () => {},
      setProfile: () => {},
      pushLocation: () => null,
      getPendingRecommendation: () => null,
    }),
    prefetchSnapshot: async () => ({
      snapshot: {
        topStations: [createStation()],
      },
    }),
    syncGeofences: async () => {},
    notifications: {
      startPredictiveLiveActivity: () => null,
      updatePredictiveLiveActivity: () => {},
      endLiveActivity: () => {},
      schedulePredictiveRecommendationNotification: async () => {},
      openNavigationForStation: async () => true,
    },
  });

  const firstBatchPromise = runtime.processLocationPayload({
    locations: [
      {
        coords: {
          latitude: 39.94,
          longitude: -75.02,
          speed: 14,
          heading: 90,
          timestamp: 1_700_000_000_000,
        },
      },
    ],
  });
  const secondBatchPromise = runtime.processLocationPayload({
    locations: [
      {
        coords: {
          latitude: 39.95,
          longitude: -75.01,
          speed: 14,
          heading: 90,
          timestamp: 1_700_000_030_000,
        },
      },
    ],
  });

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(maxInflightCount, 1);
  assert.equal(prefetchCallCount, 1);

  releaseFirstFetch();
  await Promise.all([firstBatchPromise, secondBatchPromise]);

  assert.equal(maxInflightCount, 1);
  assert.equal(prefetchCallCount, 2);
});
