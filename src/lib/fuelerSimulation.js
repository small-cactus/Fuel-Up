/**
 * Fueler simulation framework.
 *
 * Generates realistic daily driving patterns for different user archetypes
 * over an extended period (e.g. 21 days), letting us test how the
 * predictive recommender performs as user history accumulates and as the
 * driver encounters varied conditions (commutes, weekends, road trips).
 *
 * Every route is built from location samples alone — no ground-truth labels
 * leak into the engine. The engine sees the same GPS+profile data a real
 * background app would have.
 */

const { addDrivingNoise } = require('./driveNoise.js');
const { routeToSamples } = require('./predictionMetrics.js');
const { haversineDistanceMeters } = require('../screens/onboarding/predictive/simulationMath.cjs');
const { inferTypicalIntervalMiles, estimateFuelState } = require('./rangeEstimator.js');
const {
  GROUNDED_SIM_STATIONS,
  getGroundedRouteFixture,
  getGroundedRouteStations,
} = require('./groundedSimulationData.js');

function mulberry32(seed) {
  return function rand() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Station catalog used by all simulated days. Each station is anchored to a
// specific coordinate so the routes can reference them consistently.
const SIM_STATIONS = [
  // Cheap budget stations
  { stationId: 'sim-costco-s', stationName: 'Costco South', brand: 'Costco', latitude: 39.6128, longitude: -104.9872, price: 3.09, distanceMiles: 0 },
  { stationId: 'sim-costco-n', stationName: 'Costco North', brand: 'Costco', latitude: 39.8500, longitude: -104.9900, price: 3.11, distanceMiles: 0 },
  { stationId: 'sim-sams-club', stationName: "Sam's Club Fuel", brand: "Sam's Club", latitude: 39.7000, longitude: -105.0500, price: 3.12, distanceMiles: 0 },

  // Mid-range brands
  { stationId: 'sim-king-soopers-west', stationName: 'King Soopers West', brand: 'King Soopers', latitude: 39.7388, longitude: -105.0827, price: 3.19, distanceMiles: 0 },
  { stationId: 'sim-king-soopers-east', stationName: 'King Soopers East', brand: 'King Soopers', latitude: 39.7400, longitude: -104.9300, price: 3.22, distanceMiles: 0 },
  { stationId: 'sim-maverik-alameda', stationName: 'Maverik Alameda', brand: 'Maverik', latitude: 39.7131, longitude: -105.0169, price: 3.29, distanceMiles: 0 },
  { stationId: 'sim-maverik-havana', stationName: 'Maverik Havana', brand: 'Maverik', latitude: 39.7215, longitude: -104.8734, price: 3.24, distanceMiles: 0 },

  // Premium brands (expensive)
  { stationId: 'sim-shell-downing', stationName: 'Shell Downing', brand: 'Shell', latitude: 39.7385, longitude: -104.9726, price: 3.59, distanceMiles: 0 },
  { stationId: 'sim-shell-broadway', stationName: 'Shell Broadway', brand: 'Shell', latitude: 39.7089, longitude: -104.9876, price: 3.55, distanceMiles: 0 },
  { stationId: 'sim-chevron-speer', stationName: 'Chevron Speer', brand: 'Chevron', latitude: 39.7399, longitude: -104.9938, price: 3.52, distanceMiles: 0 },

  // Highway stations (for road-trip tests)
  { stationId: 'sim-pilot-i70-a', stationName: 'Pilot I-70 (Aurora)', brand: 'Pilot', latitude: 39.7468, longitude: -104.8002, price: 3.49, distanceMiles: 0 },
  { stationId: 'sim-loves-i70-b', stationName: "Love's I-70 (Airpark)", brand: "Love's", latitude: 39.7470, longitude: -104.7300, price: 3.45, distanceMiles: 0 },
  { stationId: 'sim-ta-i70-c', stationName: 'TA I-70 (Bennett)', brand: 'TA', latitude: 39.7500, longitude: -104.4400, price: 3.42, distanceMiles: 0 },
  { stationId: 'sim-sinclair-i70-d', stationName: 'Sinclair I-70 (Limon)', brand: 'Sinclair', latitude: 39.2700, longitude: -103.6900, price: 3.38, distanceMiles: 0 },
];

// Helper: linear interpolation between two points producing waypoints
function interpolate(from, to, count, speedFn) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    pts.push({
      lat: from.lat + (to.lat - from.lat) * t,
      lon: from.lon + (to.lon - from.lon) * t,
      speedMph: speedFn(t),
    });
  }
  return pts;
}

function stitchInterpolatedPoints(controlPoints, segmentPointCount, speedFns = []) {
  const points = [];
  for (let index = 1; index < controlPoints.length; index += 1) {
    const from = controlPoints[index - 1];
    const to = controlPoints[index];
    const speedFn = speedFns[index - 1] || (() => 24);
    const segment = interpolate(from, to, segmentPointCount, speedFn);
    if (points.length > 0) {
      segment.shift();
    }
    points.push(...segment);
  }
  return points;
}

function findStationById(stationId) {
  return [...SIM_STATIONS, ...GROUNDED_SIM_STATIONS].find(station => station.stationId === stationId) || null;
}

function buildWaypointsFromGroundedRoute(template, fallbackPointCount = 5) {
  const groundedRoute = getGroundedRouteFixture(template?.groundedRouteId || template?.id);
  if (!groundedRoute || !Array.isArray(groundedRoute.routeCoordinates) || groundedRoute.routeCoordinates.length < 2) {
    return stitchInterpolatedPoints(template.controlPoints, fallbackPointCount, template.speedFns);
  }

  const routeDistanceMiles = groundedRoute.distanceMeters > 0
    ? groundedRoute.distanceMeters / 1609.344
    : routeDistanceMilesFromWaypoints(
      groundedRoute.routeCoordinates.map(coordinate => ({
        lat: coordinate.latitude,
        lon: coordinate.longitude,
      }))
    );
  const averageSpeedMph = groundedRoute.expectedTravelTimeSeconds > 0
    ? Math.max(10, Math.min(72, routeDistanceMiles / (groundedRoute.expectedTravelTimeSeconds / 3600)))
    : 28;

  return groundedRoute.routeCoordinates.map((coordinate, index, coordinates) => {
    const progress = coordinates.length > 1 ? index / (coordinates.length - 1) : 0;
    const taper = progress < 0.08 || progress > 0.92 ? 0.78 : (progress < 0.20 || progress > 0.80 ? 0.88 : 1);
    return {
      lat: coordinate.latitude,
      lon: coordinate.longitude,
      speedMph: Math.round(averageSpeedMph * taper * 10) / 10,
    };
  });
}

function getTemplateCandidateStationIds(template) {
  const groundedStations = getGroundedRouteStations(template?.groundedRouteId || template?.id);
  if (groundedStations.length > 0) {
    return groundedStations.map(station => station.stationId);
  }
  return Array.isArray(template?.candidateStationIds) ? template.candidateStationIds.slice() : [];
}

function getTemplateStationMarket(template) {
  const groundedStations = getGroundedRouteStations(template?.groundedRouteId || template?.id);
  if (groundedStations.length > 0) {
    return groundedStations;
  }
  return getTemplateCandidateStationIds(template)
    .map(findStationById)
    .filter(Boolean);
}

function choose(rand, items) {
  return items[Math.floor(rand() * items.length)];
}

function randomInt(rand, min, maxInclusive) {
  return min + Math.floor(rand() * ((maxInclusive - min) + 1));
}

function routeDistanceMilesFromWaypoints(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return 0;
  let totalMeters = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    totalMeters += haversineDistanceMeters(
      { latitude: waypoints[index - 1].lat, longitude: waypoints[index - 1].lon },
      { latitude: waypoints[index].lat, longitude: waypoints[index].lon }
    );
  }
  return totalMeters / 1609.344;
}

const HIDDEN_INTENT_BLUEPRINTS = [
  {
    id: 'city-cross-town',
    groundedRouteId: 'weekday-urban-commute',
    scenario: 'city',
    defaultHour: 8,
    dayOfWeek: 2,
    hiddenFuelProbability: 0.38,
    candidateStationIds: ['sim-king-soopers-east', 'sim-chevron-speer'],
    controlPoints: [
      { lat: 39.7385, lon: -105.0700 },
      { lat: 39.7390, lon: -105.0300 },
      { lat: 39.7392, lon: -104.9950 },
      { lat: 39.7400, lon: -104.9360 },
    ],
    speedFns: [() => 27, () => 23, () => 26],
  },
  {
    id: 'south-errand-arc',
    groundedRouteId: 'south-urban-errand',
    scenario: 'city',
    defaultHour: 13,
    dayOfWeek: 4,
    hiddenFuelProbability: 0.08,
    candidateStationIds: ['sim-shell-broadway', 'sim-maverik-alameda'],
    controlPoints: [
      { lat: 39.7050, lon: -105.0600 },
      { lat: 39.7080, lon: -105.0200 },
      { lat: 39.7130, lon: -104.9900 },
      { lat: 39.7180, lon: -104.9300 },
    ],
    speedFns: [() => 24, () => 21, () => 26],
  },
  {
    id: 'north-suburban-run',
    groundedRouteId: 'north-club-run',
    scenario: 'suburban',
    defaultHour: 11,
    dayOfWeek: 6,
    hiddenFuelProbability: 0.30,
    candidateStationIds: ['sim-costco-n', 'sim-sams-club'],
    controlPoints: [
      { lat: 39.8000, lon: -105.0700 },
      { lat: 39.8200, lon: -105.0400 },
      { lat: 39.8400, lon: -105.0100 },
      { lat: 39.8505, lon: -104.9920 },
    ],
    speedFns: [() => 32, () => 30, () => 34],
  },
  {
    id: 'airport-corridor',
    groundedRouteId: 'airport-corridor-run',
    scenario: 'highway',
    defaultHour: 10,
    dayOfWeek: 3,
    hiddenFuelProbability: 0.32,
    candidateStationIds: ['sim-loves-i70-b', 'sim-pilot-i70-a'],
    controlPoints: [
      { lat: 39.7440, lon: -105.0050 },
      { lat: 39.7460, lon: -104.9300 },
      { lat: 39.7470, lon: -104.8200 },
      { lat: 39.7471, lon: -104.7360 },
    ],
    speedFns: [() => 58, () => 64, () => 67],
  },
  {
    id: 'downtown-grid',
    groundedRouteId: 'downtown-grid-hop',
    scenario: 'city_grid',
    defaultHour: 17,
    dayOfWeek: 2,
    hiddenFuelProbability: 0.08,
    candidateStationIds: ['sim-chevron-speer', 'sim-shell-downing'],
    controlPoints: [
      { lat: 39.7500, lon: -105.0150 },
      { lat: 39.7480, lon: -105.0000 },
      { lat: 39.7420, lon: -104.9920 },
      { lat: 39.7410, lon: -104.9940 },
      { lat: 39.7399, lon: -104.9939 },
    ],
    speedFns: [() => 18, () => 14, () => 16, () => 17],
  },
];

const HIDDEN_COMMIT_BLUEPRINTS = [
  {
    id: 'city-turnin-east',
    groundedRouteId: 'weekday-urban-commute',
    scenario: 'city',
    defaultHour: 8,
    dayOfWeek: 2,
    hiddenFuelProbability: 0.42,
    candidateStationIds: ['sim-king-soopers-east'],
    controlPoints: [
      { lat: 39.7385, lon: -105.0700 },
      { lat: 39.7390, lon: -105.0300 },
      { lat: 39.7392, lon: -104.9950 },
      { lat: 39.7400, lon: -104.9450 },
    ],
    speedFns: [() => 27, () => 23, () => 26],
  },
  {
    id: 'suburban-club-turnin',
    groundedRouteId: 'north-club-run',
    scenario: 'suburban',
    defaultHour: 11,
    dayOfWeek: 6,
    hiddenFuelProbability: 0.34,
    candidateStationIds: ['sim-costco-n'],
    controlPoints: [
      { lat: 39.8000, lon: -105.0700 },
      { lat: 39.8200, lon: -105.0400 },
      { lat: 39.8400, lon: -105.0100 },
      { lat: 39.8550, lon: -104.9550 },
    ],
    speedFns: [() => 32, () => 30, () => 34],
  },
  {
    id: 'highway-loves-turnin',
    groundedRouteId: 'airport-corridor-run',
    scenario: 'highway',
    defaultHour: 10,
    dayOfWeek: 3,
    hiddenFuelProbability: 0.36,
    candidateStationIds: ['sim-loves-i70-b'],
    controlPoints: [
      { lat: 39.7440, lon: -105.0050 },
      { lat: 39.7460, lon: -104.9300 },
      { lat: 39.7470, lon: -104.8200 },
      { lat: 39.7480, lon: -104.6900 },
    ],
    speedFns: [() => 58, () => 64, () => 67],
  },
  {
    id: 'grid-chevron-turnin',
    groundedRouteId: 'downtown-grid-hop',
    scenario: 'city_grid',
    defaultHour: 17,
    dayOfWeek: 2,
    hiddenFuelProbability: 0.16,
    candidateStationIds: ['sim-chevron-speer'],
    controlPoints: [
      { lat: 39.7500, lon: -105.0150 },
      { lat: 39.7480, lon: -105.0000 },
      { lat: 39.7420, lon: -104.9920 },
      { lat: 39.7370, lon: -104.9780 },
      { lat: 39.7310, lon: -104.9650 },
    ],
    speedFns: [() => 18, () => 14, () => 16, () => 17],
  },
];

function buildHiddenIntentRoute({
  blueprint,
  routeIndex,
  rand,
  willStopOverride,
  destinationStationIdOverride,
  hiddenDecisionIndexOverride,
}) {
  const resolvedBlueprint = {
    ...blueprint,
    candidateStationIds: getTemplateCandidateStationIds(blueprint),
  };
  const baseWaypoints = buildWaypointsFromGroundedRoute(resolvedBlueprint, 5);
  const willStop = typeof willStopOverride === 'boolean'
    ? willStopOverride
    : rand() < blueprint.hiddenFuelProbability;
  const hiddenDecisionIndex = willStop
    ? (
      Number.isInteger(hiddenDecisionIndexOverride)
        ? hiddenDecisionIndexOverride
        : randomInt(rand, Math.max(4, Math.floor(baseWaypoints.length * 0.35)), Math.max(5, Math.floor(baseWaypoints.length * 0.72)))
    )
    : null;
  let waypoints = baseWaypoints;
  let destinationStationId = null;
  let recommendationStationId = null;
  let targetStation = null;

  if (willStop) {
    destinationStationId = destinationStationIdOverride || choose(rand, resolvedBlueprint.candidateStationIds);
    recommendationStationId = destinationStationId;
    targetStation = findStationById(destinationStationId);
    const pivot = baseWaypoints[hiddenDecisionIndex];
    const branch = interpolate(
      { lat: pivot.lat, lon: pivot.lon },
      { lat: targetStation.latitude, lon: targetStation.longitude },
      6,
      (t) => Math.max(6, ((pivot.speedMph || 24) * (1 - (t * 0.55)))),
    );
    waypoints = [
      ...baseWaypoints.slice(0, hiddenDecisionIndex + 1),
      ...branch.slice(1),
    ];
  }

  return {
    id: `${blueprint.id}-${routeIndex}`,
    scenario: blueprint.scenario,
    waypoints,
    overrideTime: { hour: blueprint.defaultHour, dayOfWeek: blueprint.dayOfWeek },
    destinationStationId,
    recommendationStationId,
    expectsTrigger: willStop,
    willStop,
    hiddenDecisionIndex,
    targetStationId: destinationStationId,
    groundTruthOnly: {
      hiddenDecisionIndex,
      targetStationId: destinationStationId,
    },
  };
}

function buildStressProfile(historyLevel = 'none') {
  const now = Date.now();
  const baseProfile = {
    preferredBrands: [],
    brandLoyalty: 0.05,
    typicalFillUpIntervalMiles: 300,
    fillUpHistory: [
      { timestamp: now - 4 * 86_400_000, odometer: 40220, gallons: 11.8, pricePerGallon: 3.41 },
    ],
    estimatedMilesSinceLastFill: 125,
    odometerMiles: 40345,
  };
  if (historyLevel === 'rich') {
    return {
      ...baseProfile,
      typicalFillUpIntervalMiles: 290,
      visitHistory: [
        { stationId: 'sim-king-soopers-east', visitCount: 2, lastVisitMs: now - 2 * 86_400_000, visitTimestamps: [now - 2 * 86_400_000, now - 9 * 86_400_000] },
        { stationId: 'sim-shell-downing', visitCount: 2, lastVisitMs: now - 86_400_000, visitTimestamps: [now - 86_400_000, now - 7 * 86_400_000] },
        { stationId: 'sim-loves-i70-b', visitCount: 4, lastVisitMs: now - 3 * 86_400_000, visitTimestamps: [now - 3 * 86_400_000, now - 10 * 86_400_000, now - 14 * 86_400_000] },
        { stationId: 'sim-costco-n', visitCount: 4, lastVisitMs: now - 5 * 86_400_000, visitTimestamps: [now - 5 * 86_400_000, now - 12 * 86_400_000, now - 16 * 86_400_000] },
        { stationId: 'sim-chevron-speer', visitCount: 2, lastVisitMs: now - 7 * 86_400_000, visitTimestamps: [now - 7 * 86_400_000, now - 15 * 86_400_000] },
      ],
      fillUpHistory: [
        ...baseProfile.fillUpHistory,
        { timestamp: now - 9 * 86_400_000, odometer: 39940, gallons: 11.6, pricePerGallon: 3.38 },
      ],
      estimatedMilesSinceLastFill: 150,
      odometerMiles: 40495,
    };
  }
  if (historyLevel === 'light') {
    return {
      ...baseProfile,
      typicalFillUpIntervalMiles: 295,
      visitHistory: [
        { stationId: 'sim-king-soopers-east', visitCount: 2, lastVisitMs: now - 86_400_000, visitTimestamps: [now - 86_400_000] },
        { stationId: 'sim-loves-i70-b', visitCount: 1, lastVisitMs: now - 5 * 86_400_000, visitTimestamps: [now - 5 * 86_400_000] },
        { stationId: 'sim-costco-n', visitCount: 1, lastVisitMs: now - 8 * 86_400_000, visitTimestamps: [now - 8 * 86_400_000] },
      ],
      estimatedMilesSinceLastFill: 135,
      odometerMiles: 40480,
    };
  }
  return {
    ...baseProfile,
    visitHistory: [],
  };
}

function cloneProfile(profile) {
  return {
    ...profile,
    preferredBrands: [...(profile?.preferredBrands || [])],
    visitHistory: (profile?.visitHistory || []).map(entry => ({
      ...entry,
      visitTimestamps: [...(entry.visitTimestamps || [])],
      contextCounts: entry?.contextCounts ? { ...entry.contextCounts } : undefined,
    })),
    exposureHistory: (profile?.exposureHistory || []).map(entry => ({
      ...entry,
      contextCounts: entry?.contextCounts ? { ...entry.contextCounts } : undefined,
    })),
    fillUpHistory: (profile?.fillUpHistory || []).map(entry => ({ ...entry })),
  };
}

function chooseWeighted(rand, weightedItems) {
  const totalWeight = weightedItems.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return weightedItems[0]?.item || null;
  }
  let cursor = rand() * totalWeight;
  for (const entry of weightedItems) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.item;
    }
  }
  return weightedItems[weightedItems.length - 1]?.item || null;
}

function scoreStressTargetStation(station, profile, blueprint, remainingMiles, stationIndex = 0, candidateCount = 1) {
  const brandAffinity = (profile.preferredBrands || []).some(
    brand => String(station.brand || '').toLowerCase().includes(String(brand).toLowerCase())
  ) ? 0.16 + ((profile.brandLoyalty || 0) * 0.18) : 0;
  const scenarioFit = blueprint.scenario === 'highway'
    ? (['Pilot', "Love's", 'TA', 'Sinclair'].includes(station.brand) ? 0.14 : 0)
    : (['Costco', "Sam's Club", 'King Soopers', 'Maverik', 'Shell', 'Chevron'].includes(station.brand) ? 0.08 : 0);
  const priceScore = Math.max(0, 3.8 - Number(station.price || 3.8)) * 0.30;
  const lowFuelBias = remainingMiles <= 45 ? 0.18 : (remainingMiles <= 70 ? 0.10 : 0);
  const normalizedIndex = candidateCount > 1 ? stationIndex / (candidateCount - 1) : 0;
  const earlierStopBias = remainingMiles <= 55
    ? (1 - normalizedIndex) * 0.26
    : ((remainingMiles >= 95 ? normalizedIndex : (1 - Math.abs(normalizedIndex - 0.5) * 2)) * 0.10);
  return 0.10 + brandAffinity + scenarioFit + priceScore + lowFuelBias + earlierStopBias;
}

function buildAdaptiveHiddenIntentStressRoutes({ seed = 2026, routeCount = 72, historyLevel = 'none' } = {}) {
  const rand = mulberry32(seed);
  const profile = cloneProfile(buildStressProfile(historyLevel));
  const routes = [];
  let odometerMiles = Number(profile.odometerMiles) || 40000;
  let milesSinceLastFill = Number.isFinite(Number(profile.estimatedMilesSinceLastFill))
    ? Number(profile.estimatedMilesSinceLastFill)
    : estimateFuelState(profile.fillUpHistory, {
      typicalIntervalMiles: profile.typicalFillUpIntervalMiles,
    }).milesSinceLastFill;

  for (let index = 0; index < routeCount; index += 1) {
    const noFuelBlueprint = choose(rand, HIDDEN_INTENT_BLUEPRINTS);
    const noFuelCandidateStationIds = getTemplateCandidateStationIds(noFuelBlueprint);
    const baseWaypoints = buildWaypointsFromGroundedRoute({
      ...noFuelBlueprint,
      candidateStationIds: noFuelCandidateStationIds,
    }, 5);
    const fuelStateBefore = estimateFuelState(profile.fillUpHistory, {
      milesSinceLastFill,
      typicalIntervalMiles: profile.typicalFillUpIntervalMiles,
    });
    const remainingMiles = fuelStateBefore.estimatedRemainingMiles;
    const avgIntervalMiles = Math.max(
      160,
      Number(fuelStateBefore.avgIntervalMiles) || Number(profile.typicalFillUpIntervalMiles) || 280
    );

    const needProbability = remainingMiles <= 35
      ? 0.88
      : remainingMiles <= 55
        ? 0.72
        : remainingMiles <= 75
          ? 0.40
          : remainingMiles <= 100
            ? 0.16
            : remainingMiles <= 125
              ? 0.05
              : 0.008;
    const scenarioMultiplier = noFuelBlueprint.scenario === 'highway'
      ? 1.10
      : (noFuelBlueprint.scenario === 'suburban'
        ? 0.95
        : (noFuelBlueprint.scenario === 'city_grid' ? 0.64 : 0.78));
    const routeDistanceMiles = routeDistanceMilesFromWaypoints(baseWaypoints);
    const routeConsumptionPressure = Math.min(1, routeDistanceMiles / Math.max(avgIntervalMiles, 1));
    const latentFuelNeed = Math.min(1, Math.max(0, 1 - (remainingMiles / avgIntervalMiles)));
    const impulsiveFloor = remainingMiles <= 125 ? 0.004 : 0.001;
    const hiddenFuelProbability = Math.max(
      0.002,
      Math.min(
        0.88,
        (needProbability * scenarioMultiplier) +
        (routeConsumptionPressure * 0.04) +
        (latentFuelNeed * 0.06) +
        (noFuelBlueprint.hiddenFuelProbability * 0.02) +
        impulsiveFloor
      )
    );
    const willStop = rand() < hiddenFuelProbability;
    const blueprint = willStop
      ? chooseWeighted(rand, HIDDEN_COMMIT_BLUEPRINTS
        .filter(entry => entry.scenario === noFuelBlueprint.scenario)
        .map(entry => ({
          item: entry,
          weight: (entry.hiddenFuelProbability * 0.6) + (
            entry.scenario === 'highway' && remainingMiles <= 55 ? 0.24 :
            entry.scenario === 'suburban' && remainingMiles <= 70 ? 0.18 :
            entry.scenario === 'city' ? 0.16 :
            0.08
          ),
        })))
      : noFuelBlueprint;
    const realizedRouteDistanceMiles = routeDistanceMilesFromWaypoints(
      buildWaypointsFromGroundedRoute({
        ...blueprint,
        candidateStationIds: getTemplateCandidateStationIds(blueprint),
      }, 5)
    );

    const destinationStationId = willStop
      ? chooseWeighted(rand, getTemplateCandidateStationIds(blueprint)
        .map((stationId, stationIndex) => ({
          station: findStationById(stationId),
          stationIndex,
        }))
        .filter(entry => entry.station)
        .filter(Boolean)
        .map(entry => ({
          item: entry.station.stationId,
          weight: scoreStressTargetStation(
            entry.station,
            profile,
            blueprint,
            remainingMiles,
            entry.stationIndex,
            getTemplateCandidateStationIds(blueprint).length
          ),
        })))
      : null;

    const hiddenDecisionLowerBound = Math.max(4, Math.floor(baseWaypoints.length * (remainingMiles <= 45 ? 0.28 : 0.40)));
    const hiddenDecisionUpperBound = Math.max(hiddenDecisionLowerBound + 1, Math.floor(baseWaypoints.length * (remainingMiles <= 45 ? 0.58 : 0.74)));
    const hiddenDecisionIndex = willStop
      ? randomInt(rand, hiddenDecisionLowerBound, hiddenDecisionUpperBound)
      : null;

    const route = buildHiddenIntentRoute({
      blueprint,
      routeIndex: index,
      rand,
      willStopOverride: willStop,
      destinationStationIdOverride: destinationStationId,
      hiddenDecisionIndexOverride: hiddenDecisionIndex,
    });

    route.startingMilesSinceLastFill = Math.round(milesSinceLastFill);
    route.fuelStateBefore = fuelStateBefore;
    route.intentClass = remainingMiles <= 110 ? 'probable' : 'impulsive';
    route.routeDistanceMiles = Math.round(realizedRouteDistanceMiles * 10) / 10;
    routes.push(route);

    odometerMiles += realizedRouteDistanceMiles;
    if (willStop && destinationStationId) {
      const fillGallons = Math.max(8.5, Math.min(14.2, (fuelStateBefore.avgIntervalMiles - remainingMiles) / 24));
      profile.fillUpHistory.push({
        timestamp: Date.now() + index * 60_000,
        odometer: odometerMiles,
        gallons: Math.round(fillGallons * 10) / 10,
        pricePerGallon: findStationById(destinationStationId)?.price || 3.39,
      });
      const existingVisit = profile.visitHistory.find(entry => entry.stationId === destinationStationId);
      if (existingVisit) {
        existingVisit.visitCount += 1;
        existingVisit.lastVisitMs = Date.now() + index * 60_000;
        existingVisit.visitTimestamps = existingVisit.visitTimestamps || [];
        existingVisit.visitTimestamps.push(existingVisit.lastVisitMs);
      } else {
        profile.visitHistory.push({
          stationId: destinationStationId,
          visitCount: 1,
          lastVisitMs: Date.now() + index * 60_000,
          visitTimestamps: [Date.now() + index * 60_000],
        });
      }
      milesSinceLastFill = 0;
    } else {
      milesSinceLastFill += realizedRouteDistanceMiles;
    }
    profile.estimatedMilesSinceLastFill = milesSinceLastFill;
    profile.odometerMiles = odometerMiles;
  }

  return routes;
}

function buildHiddenIntentStressRoutes({ seed = 2026, routeCount = 72 } = {}) {
  return buildAdaptiveHiddenIntentStressRoutes({
    seed,
    routeCount,
    historyLevel: 'none',
  });
}

const REALISTIC_ROUTE_TEMPLATES = [
  {
    id: 'weekday-urban-commute',
    scenario: 'city',
    purpose: 'commute',
    defaultHour: 8,
    weekdayWeight: 0.28,
    weekendWeight: 0.04,
    candidateStationIds: ['sim-king-soopers-east', 'sim-chevron-speer', 'sim-shell-downing'],
    controlPoints: [
      { lat: 39.7385, lon: -105.0700 },
      { lat: 39.7390, lon: -105.0300 },
      { lat: 39.7392, lon: -104.9950 },
      { lat: 39.7400, lon: -104.9360 },
    ],
    speedFns: [() => 27, () => 23, () => 26],
  },
  {
    id: 'south-urban-errand',
    scenario: 'city',
    purpose: 'errand',
    defaultHour: 13,
    weekdayWeight: 0.12,
    weekendWeight: 0.16,
    candidateStationIds: ['sim-maverik-alameda', 'sim-shell-broadway', 'sim-chevron-speer'],
    controlPoints: [
      { lat: 39.7050, lon: -105.0600 },
      { lat: 39.7080, lon: -105.0200 },
      { lat: 39.7130, lon: -104.9900 },
      { lat: 39.7180, lon: -104.9300 },
    ],
    speedFns: [() => 24, () => 21, () => 26],
  },
  {
    id: 'north-club-run',
    scenario: 'suburban',
    purpose: 'shopping',
    defaultHour: 11,
    weekdayWeight: 0.08,
    weekendWeight: 0.28,
    candidateStationIds: ['sim-costco-n', 'sim-sams-club', 'sim-king-soopers-east'],
    controlPoints: [
      { lat: 39.8000, lon: -105.0700 },
      { lat: 39.8200, lon: -105.0400 },
      { lat: 39.8400, lon: -105.0100 },
      { lat: 39.8550, lon: -104.9550 },
    ],
    speedFns: [() => 32, () => 30, () => 34],
  },
  {
    id: 'airport-corridor-run',
    scenario: 'highway',
    purpose: 'airport',
    defaultHour: 10,
    weekdayWeight: 0.11,
    weekendWeight: 0.06,
    candidateStationIds: ['sim-loves-i70-b', 'sim-pilot-i70-a', 'sim-ta-i70-c'],
    controlPoints: [
      { lat: 39.7440, lon: -105.0050 },
      { lat: 39.7460, lon: -104.9300 },
      { lat: 39.7470, lon: -104.8200 },
      { lat: 39.7471, lon: -104.7360 },
    ],
    speedFns: [() => 58, () => 64, () => 67],
  },
  {
    id: 'weekend-roadtrip-outbound',
    scenario: 'highway',
    purpose: 'roadtrip',
    defaultHour: 9,
    weekdayWeight: 0.03,
    weekendWeight: 0.14,
    candidateStationIds: ['sim-loves-i70-b', 'sim-ta-i70-c', 'sim-sinclair-i70-d'],
    controlPoints: [
      { lat: 39.7440, lon: -105.0050 },
      { lat: 39.7460, lon: -104.9000 },
      { lat: 39.7480, lon: -104.7000 },
      { lat: 39.7500, lon: -104.4300 },
    ],
    speedFns: [() => 58, () => 66, () => 69],
  },
  {
    id: 'downtown-grid-hop',
    scenario: 'city_grid',
    purpose: 'city_grid',
    defaultHour: 17,
    weekdayWeight: 0.20,
    weekendWeight: 0.06,
    candidateStationIds: ['sim-chevron-speer', 'sim-shell-downing', 'sim-king-soopers-east'],
    controlPoints: [
      { lat: 39.7500, lon: -105.0150 },
      { lat: 39.7480, lon: -105.0000 },
      { lat: 39.7420, lon: -104.9920 },
      { lat: 39.7370, lon: -104.9780 },
      { lat: 39.7310, lon: -104.9650 },
    ],
    speedFns: [() => 18, () => 14, () => 16, () => 17],
  },
  {
    id: 'weekday-return-commute',
    scenario: 'city',
    purpose: 'commute_return',
    defaultHour: 18,
    weekdayWeight: 0.22,
    weekendWeight: 0.02,
    candidateStationIds: ['sim-shell-downing', 'sim-king-soopers-west', 'sim-chevron-speer'],
    controlPoints: [
      { lat: 39.7400, lon: -104.9360 },
      { lat: 39.7392, lon: -104.9950 },
      { lat: 39.7390, lon: -105.0300 },
      { lat: 39.7385, lon: -105.0700 },
    ],
    speedFns: [() => 24, () => 21, () => 26],
  },
  {
    id: 'suburban-school-pickup',
    scenario: 'suburban',
    purpose: 'pickup',
    defaultHour: 15,
    weekdayWeight: 0.15,
    weekendWeight: 0.02,
    candidateStationIds: ['sim-costco-s', 'sim-king-soopers-west', 'sim-shell-broadway'],
    controlPoints: [
      { lat: 39.7050, lon: -105.0200 },
      { lat: 39.6900, lon: -105.0000 },
      { lat: 39.6700, lon: -104.9920 },
      { lat: 39.6400, lon: -104.9880 },
    ],
    speedFns: [() => 27, () => 23, () => 25],
  },
  {
    id: 'late-night-social-hop',
    scenario: 'city',
    purpose: 'social',
    defaultHour: 21,
    weekdayWeight: 0.05,
    weekendWeight: 0.10,
    candidateStationIds: ['sim-shell-downing', 'sim-chevron-speer', 'sim-maverik-alameda'],
    controlPoints: [
      { lat: 39.7300, lon: -105.0200 },
      { lat: 39.7360, lon: -105.0000 },
      { lat: 39.7420, lon: -104.9840 },
      { lat: 39.7480, lon: -104.9700 },
    ],
    speedFns: [() => 22, () => 26, () => 29],
  },
  {
    id: 'weekend-roadtrip-return',
    scenario: 'highway',
    purpose: 'roadtrip_return',
    defaultHour: 16,
    weekdayWeight: 0.01,
    weekendWeight: 0.10,
    candidateStationIds: ['sim-ta-i70-c', 'sim-loves-i70-b', 'sim-pilot-i70-a'],
    controlPoints: [
      { lat: 39.7500, lon: -104.4300 },
      { lat: 39.7480, lon: -104.7000 },
      { lat: 39.7460, lon: -104.9000 },
      { lat: 39.7440, lon: -105.0050 },
    ],
    speedFns: [() => 69, () => 66, () => 58],
  },
];

const REALISTIC_COHORT_ARCHETYPES = [
  { id: 'office_commuter', weight: 0.24, workMode: 'office', familyLoad: 0.25, urbanBias: 0.74, highwayBias: 0.18, nightShare: 0.10 },
  { id: 'hybrid_parent', weight: 0.20, workMode: 'hybrid', familyLoad: 0.78, urbanBias: 0.48, highwayBias: 0.20, nightShare: 0.05 },
  { id: 'suburban_value_shopper', weight: 0.16, workMode: 'local', familyLoad: 0.42, urbanBias: 0.32, highwayBias: 0.12, nightShare: 0.08 },
  { id: 'field_worker', weight: 0.14, workMode: 'mobile', familyLoad: 0.18, urbanBias: 0.22, highwayBias: 0.46, nightShare: 0.12 },
  { id: 'weekend_roadtripper', weight: 0.10, workMode: 'office', familyLoad: 0.28, urbanBias: 0.20, highwayBias: 0.58, nightShare: 0.18 },
  { id: 'student_night_driver', weight: 0.08, workMode: 'student', familyLoad: 0.06, urbanBias: 0.68, highwayBias: 0.10, nightShare: 0.34 },
  { id: 'remote_worker', weight: 0.08, workMode: 'remote', familyLoad: 0.22, urbanBias: 0.34, highwayBias: 0.08, nightShare: 0.12 },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreDriverStationAffinity(driver, station, template, stationIndex = 0, candidateCount = 1) {
  if (!station || !driver) return 0.1;
  const isClubStation = ['Costco', "Sam's Club"].includes(station.brand);
  const clubBoost = (
    (driver.memberships.costco && station.brand === 'Costco') ||
    (driver.memberships.sams && station.brand === "Sam's Club")
  ) ? 0.34 : 0;
  const highwayFit = template.scenario === 'highway'
    ? (['Pilot', "Love's", 'TA', 'Sinclair'].includes(station.brand) ? 0.24 : -0.04)
    : 0;
  const urbanFit = template.scenario !== 'highway'
    ? (['Chevron', 'Shell', 'King Soopers', 'Maverik', 'Costco', "Sam's Club"].includes(station.brand) ? 0.10 : 0)
    : 0;
  const preferredBrandBoost = (driver.preferredBrands || []).some(
    brand => String(station.brand || '').toLowerCase().includes(String(brand).toLowerCase())
  ) ? (0.18 + (driver.brandLoyalty * 0.10)) : 0;
  const savingsValue = Math.max(0, 3.85 - Number(station.price || 3.85)) * (0.18 + (driver.savingsSensitivity * 0.20));
  const scenarioBias = template.purpose === 'roadtrip'
    ? driver.highwayShare * 0.12
    : ((1 - driver.highwayShare) * 0.08);
  const habitBoost = Number(driver.stationAffinity[station.stationId]) || 0;
  const normalizedIndex = candidateCount > 1 ? stationIndex / (candidateCount - 1) : 0.5;
  const accessBias = template.scenario === 'highway'
    ? (1 - normalizedIndex) * (0.10 + (driver.lowFuelConservatism * 0.08))
    : ((1 - Math.abs(normalizedIndex - 0.5) * 2) * 0.06);
  const clubPenalty = (isClubStation && !clubBoost) ? -0.06 : 0;
  return 0.12 + clubBoost + highwayFit + urbanFit + preferredBrandBoost + savingsValue + scenarioBias + habitBoost + accessBias + clubPenalty;
}

function buildRealisticDriverSpec({ seed = 2026, historyLevel = 'none' } = {}) {
  const rand = mulberry32(seed);
  const archetype = chooseWeighted(rand, REALISTIC_COHORT_ARCHETYPES.map(item => ({ item, weight: item.weight }))) || REALISTIC_COHORT_ARCHETYPES[0];
  const memberships = {
    costco: rand() < 0.38,
    sams: rand() < 0.18,
  };
  if (memberships.costco && memberships.sams && rand() < 0.65) {
    memberships.sams = false;
  }
  const tankGallons = Math.round((12 + (rand() * 7)) * 10) / 10;
  const mpgCity = Math.round((20 + (rand() * 10)) * 10) / 10;
  const mpgHighway = Math.round((26 + (rand() * 12)) * 10) / 10;
  const weekdayRoutineStrength = Math.round((0.38 + (rand() * 0.48) + (archetype.workMode === 'office' ? 0.10 : 0)) * 1000) / 1000;
  const weekendErrandShare = Math.round((0.24 + (rand() * 0.44) + (archetype.familyLoad * 0.12)) * 1000) / 1000;
  const highwayShare = Math.round(clamp((0.08 + (rand() * 0.24) + archetype.highwayBias), 0.06, 0.72) * 1000) / 1000;
  const savingsSensitivity = Math.round((0.45 + (rand() * 0.45)) * 1000) / 1000;
  const lowFuelConservatism = Math.round((0.42 + (rand() * 0.38)) * 1000) / 1000;
  const spontaneity = Math.round((0.02 + (rand() * 0.08)) * 1000) / 1000;
  const brandLoyalty = Math.round((0.06 + (rand() * 0.34)) * 1000) / 1000;
  const familyLoad = Math.round(archetype.familyLoad * 1000) / 1000;
  const nightDrivingShare = Math.round(clamp((archetype.nightShare + (rand() * 0.08)), 0.02, 0.42) * 1000) / 1000;
  const detourTolerance = Math.round((0.18 + (rand() * 0.40) - (familyLoad * 0.12)) * 1000) / 1000;
  const routeFamiliarity = Math.round((0.36 + (rand() * 0.44) + (weekdayRoutineStrength * 0.10)) * 1000) / 1000;
  const weatherSensitivity = Math.round((0.20 + (rand() * 0.46) + (familyLoad * 0.08)) * 1000) / 1000;
  const timePressureBias = Math.round((0.14 + (rand() * 0.42) + (archetype.workMode === 'mobile' ? 0.10 : 0)) * 1000) / 1000;
  const cashConstraintLevel = Math.round(clamp(
    (archetype.familyLoad * 0.18) +
    (1 - savingsSensitivity) * 0.12 +
    (rand() * 0.55),
    0.04,
    0.95
  ) * 1000) / 1000;
  const preferredBrands = [];
  if (memberships.costco) preferredBrands.push('Costco');
  if (memberships.sams) preferredBrands.push("Sam's Club");
  if (rand() < 0.38) preferredBrands.push(choose(rand, ['Chevron', 'Shell', 'Maverik', 'King Soopers']));
  if (highwayShare >= 0.24 && rand() < 0.55) preferredBrands.push(choose(rand, ["Love's", 'Pilot', 'Sinclair']));
  const weightedMpg = (mpgCity * (1 - highwayShare)) + (mpgHighway * highwayShare);
  const typicalIntervalMiles = Math.round(tankGallons * weightedMpg * (0.60 + (lowFuelConservatism * 0.24)));
  const stationAffinity = Object.fromEntries(
    GROUNDED_SIM_STATIONS.map((station, index) => [
      station.stationId,
      clamp(
        scoreDriverStationAffinity(
          {
            memberships,
            preferredBrands,
            brandLoyalty,
            savingsSensitivity,
            highwayShare,
            stationAffinity: {},
            lowFuelConservatism,
          },
          station,
          {
            scenario: ['Pilot', "Love's", 'TA', 'Sinclair'].includes(station.brand) ? 'highway' : 'city',
            purpose: ['Pilot', "Love's", 'TA', 'Sinclair'].includes(station.brand) ? 'roadtrip' : 'errand',
          },
          index,
          GROUNDED_SIM_STATIONS.length
        ) / 2,
        0,
        0.35
      ),
    ])
  );

  return {
    seed,
    historyLevel,
    archetype: archetype.id,
    workMode: archetype.workMode,
    memberships,
    preferredBrands,
    brandLoyalty,
    savingsSensitivity,
    lowFuelConservatism,
    spontaneity,
    highwayShare,
    urbanBias: archetype.urbanBias,
    weekdayRoutineStrength,
    weekendErrandShare,
    familyLoad,
    nightDrivingShare,
    detourTolerance,
    routeFamiliarity,
    weatherSensitivity,
    timePressureBias,
    cashConstraintLevel,
    tankGallons,
    mpgCity,
    mpgHighway,
    weightedMpg,
    typicalIntervalMiles,
    stationAffinity,
  };
}

function chooseWeatherCondition(rand, scenario, driver, routeIndex) {
  const seasonPhase = routeIndex % 28;
  const winterBias = seasonPhase <= 6 || seasonPhase >= 24;
  const weights = [
    { item: 'clear', weight: scenario === 'highway' ? 0.48 : 0.52 },
    { item: 'rain', weight: 0.20 + (driver.weatherSensitivity * 0.06) },
    { item: 'wind', weight: scenario === 'highway' ? 0.12 : 0.05 },
    { item: 'snow', weight: winterBias ? (0.14 + (driver.weatherSensitivity * 0.08)) : 0.03 },
    { item: 'heat', weight: seasonPhase >= 12 && seasonPhase <= 20 ? 0.10 : 0.03 },
  ];
  return chooseWeighted(rand, weights) || 'clear';
}

function chooseTrafficLevel(rand, template, routeIndex, driver, hour) {
  const weekday = routeIndex % 7;
  const isWeekend = weekday === 0 || weekday === 6;
  const rushHour = !isWeekend && ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18));
  const weights = [
    { item: 'free_flow', weight: template.scenario === 'highway' ? 0.24 : 0.12 },
    { item: 'steady', weight: 0.40 },
    { item: 'congested', weight: rushHour ? 0.28 + (driver.timePressureBias * 0.10) : 0.18 },
    { item: 'gridlock', weight: rushHour && template.scenario !== 'highway' ? (0.12 + (driver.urbanBias * 0.06)) : 0.03 },
  ];
  return chooseWeighted(rand, weights) || 'steady';
}

function chooseOccupancy(rand, driver, template, dayOfWeek) {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const familyChance = driver.familyLoad * (isWeekend ? 0.74 : 0.42);
  const riderChance = template.purpose === 'social'
    ? 0.48
    : (template.purpose === 'pickup' ? 0.72 : familyChance);
  if (rand() < riderChance) {
    return driver.familyLoad >= 0.55 || template.purpose === 'pickup'
      ? 'kids'
      : 'passenger';
  }
  return 'solo';
}

function buildRouteExposure(candidateStationIds, rand, template, context) {
  const deduped = Array.from(new Set(candidateStationIds || []));
  const targetVisibleCount = template.scenario === 'highway'
    ? 2 + (context.trafficLevel === 'free_flow' ? 1 : 0)
    : (context.trafficLevel === 'gridlock' ? 1 : 2);
  const shuffled = [...deduped];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rand() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const visibleStationIds = shuffled.slice(0, Math.max(1, Math.min(shuffled.length, targetVisibleCount)));
  return {
    visibleStationIds,
    visibleStationCount: visibleStationIds.length,
    exposureQuality: template.scenario === 'highway'
      ? (context.trafficLevel === 'free_flow' ? 'long_corridor' : 'compressed_corridor')
      : (context.trafficLevel === 'gridlock' ? 'short_horizon' : 'city_corridor'),
  };
}

function buildRealisticTripContext({ rand, driver, template, routeIndex, dayOfWeek, hour }) {
  const weather = chooseWeatherCondition(rand, template.scenario, driver, routeIndex);
  const trafficLevel = chooseTrafficLevel(rand, template, routeIndex, driver, hour);
  const occupancy = chooseOccupancy(rand, driver, template, dayOfWeek);
  const timePressure = clamp(
    (driver.timePressureBias * 0.55) +
    (trafficLevel === 'gridlock' ? 0.22 : (trafficLevel === 'congested' ? 0.14 : 0.04)) +
    (occupancy === 'kids' ? 0.10 : (occupancy === 'passenger' ? 0.05 : 0)) +
    (template.purpose === 'airport' ? 0.18 : (template.purpose === 'pickup' ? 0.14 : 0)) +
    (weather === 'snow' ? 0.08 : 0),
    0,
    1
  );
  const routineStrength = clamp(
    (template.purpose.startsWith('commute') ? driver.weekdayRoutineStrength : driver.routeFamiliarity) +
    (template.purpose === 'pickup' ? 0.18 : 0) -
    (template.purpose === 'social' ? 0.14 : 0),
    0,
    1
  );
  const roadComplexity = clamp(
    (template.scenario === 'city_grid' ? 0.78 : template.scenario === 'city' ? 0.52 : template.scenario === 'suburban' ? 0.36 : 0.24) +
    (trafficLevel === 'gridlock' ? 0.14 : trafficLevel === 'congested' ? 0.08 : 0) +
    (weather === 'snow' ? 0.10 : weather === 'rain' ? 0.05 : 0),
    0,
    1
  );
  const payCyclePhase = routeIndex % 14;
  const cheapnessBias = clamp(
    driver.savingsSensitivity +
    (payCyclePhase >= 10 ? 0.10 : 0) +
    (driver.memberships.costco || driver.memberships.sams ? 0.08 : 0),
    0,
    1
  );
  return {
    weather,
    trafficLevel,
    occupancy,
    timePressure,
    routineStrength,
    roadComplexity,
    cheapnessBias,
  };
}

function scoreCohortStationChoice(driver, station, template, context, remainingMiles, stationIndex = 0, candidateCount = 1) {
  const baseAffinity = scoreDriverStationAffinity(driver, station, template, stationIndex, candidateCount);
  const normalizedIndex = candidateCount > 1 ? stationIndex / (candidateCount - 1) : 0.5;
  const easierAccessBias = template.scenario === 'highway'
    ? (1 - normalizedIndex) * 0.18
    : ((1 - Math.abs(normalizedIndex - 0.5) * 2) * 0.10);
  const timePressurePenalty = context.timePressure * (template.scenario === 'highway' ? normalizedIndex * 0.08 : 0.12);
  const familyPenalty = context.occupancy === 'kids'
    ? normalizedIndex * 0.10
    : (context.occupancy === 'passenger' ? normalizedIndex * 0.04 : 0);
  const nightHabitBoost = context.weather === 'snow' || context.weather === 'rain'
    ? (Number(driver.stationAffinity[station.stationId]) || 0) * 0.30
    : 0;
  const fuelUrgencyBonus = remainingMiles <= 75 ? (1 - normalizedIndex) * 0.12 : 0;
  const priceBias = Math.max(0, 3.80 - Number(station.price || 3.80)) * (0.08 + (context.cheapnessBias * 0.14));
  const detourPenalty = (1 - driver.detourTolerance) * normalizedIndex * 0.08;
  return clamp(
    baseAffinity +
    easierAccessBias +
    fuelUrgencyBonus +
    nightHabitBoost +
    priceBias -
    timePressurePenalty -
    familyPenalty -
    detourPenalty,
    0.01,
    1.6
  );
}

function toIncomeBand(driver) {
  if (driver.cashConstraintLevel >= 0.72) return 'under_50k';
  if (driver.cashConstraintLevel >= 0.48) return '50k_100k';
  return '100k_plus';
}

function buildHouseholdRecord(driver, driverIndex) {
  return {
    household_id: `household-${driverIndex}`,
    home_zone: `zone-home-${driverIndex % 12}`,
    home_lat: 39.70 + ((driverIndex % 9) * 0.015),
    home_lon: -105.05 + ((driverIndex % 7) * 0.014),
    income_band: toIncomeBand(driver),
    household_size: driver.familyLoad >= 0.65 ? 4 : (driver.familyLoad >= 0.35 ? 3 : 2),
    workers: driver.workMode === 'remote' ? 1 : (driver.familyLoad >= 0.5 ? 2 : 1),
    children: driver.familyLoad >= 0.60 ? 2 : (driver.familyLoad >= 0.35 ? 1 : 0),
    vehicles_available: driver.highwayShare >= 0.35 ? 2 : 1,
    housing_type: driver.urbanBias >= 0.62 ? 'multi_family' : 'single_family',
    urbanicity: driver.urbanBias >= 0.62 ? 'urban' : (driver.urbanBias >= 0.40 ? 'suburban' : 'exurban'),
    population_weight: Math.round((0.7 + (driver.weekdayRoutineStrength * 0.7)) * 1000) / 1000,
    train_weight: 1,
  };
}

function buildPersonRecord(driver, driverIndex, household) {
  const ageBand = driver.archetype === 'student_night_driver'
    ? '18_24'
    : (driver.familyLoad >= 0.55 ? '35_49' : '25_44');
  return {
    person_id: `person-${driverIndex}`,
    household_id: household.household_id,
    age_band: ageBand,
    worker_flag: driver.workMode !== 'student',
    student_flag: driver.workMode === 'student',
    shift_type: driver.nightDrivingShare >= 0.24 ? 'mixed' : 'day',
    telework_rate: driver.workMode === 'remote' ? 0.9 : (driver.workMode === 'hybrid' ? 0.45 : 0.05),
    license_flag: true,
    app_usage_flag: true,
    price_sensitivity: driver.savingsSensitivity,
    time_value: Math.round((0.25 + (driver.timePressureBias * 0.75)) * 1000) / 1000,
    detour_tolerance: driver.detourTolerance,
    brand_loyalty_strength: driver.brandLoyalty,
    habit_strength: driver.routeFamiliarity,
    fuel_anxiety: driver.lowFuelConservatism,
    planning_horizon: Math.round((0.2 + (driver.weekdayRoutineStrength * 0.6)) * 1000) / 1000,
    night_driving_propensity: driver.nightDrivingShare,
    cash_constraint_level: driver.cashConstraintLevel,
  };
}

function buildVehicleRecord(driver, driverIndex, household, person) {
  const loyaltyPrograms = [];
  if (driver.memberships.costco) loyaltyPrograms.push('costco');
  if (driver.memberships.sams) loyaltyPrograms.push('sams');
  return {
    vehicle_id: `vehicle-${driverIndex}`,
    household_id: household.household_id,
    primary_driver_id: person.person_id,
    fuel_type: 'gasoline',
    required_octane: driver.preferredBrands.includes('Chevron') || driver.preferredBrands.includes('Shell') ? 'regular' : 'regular',
    body_type: driver.highwayShare >= 0.4 ? 'crossover' : (driver.familyLoad >= 0.55 ? 'suv' : 'sedan'),
    model_year: 2014 + (driverIndex % 10),
    mpg_label: Math.round(driver.weightedMpg * 10) / 10,
    tank_capacity_gal: driver.tankGallons,
    reserve_threshold_gal: Math.round(Math.max(1.2, driver.tankGallons * (0.08 + (driver.lowFuelConservatism * 0.05))) * 10) / 10,
    gauge_noise_sd: Math.round((0.03 + (driver.weatherSensitivity * 0.03)) * 1000) / 1000,
    home_parking_flag: household.housing_type === 'single_family',
    fleet_card_flag: driver.workMode === 'mobile',
    loyalty_programs: loyaltyPrograms,
  };
}

function buildObservedFuelState(route, vehicle, driver, rand) {
  const remainingMiles = Number(route.fuelStateBefore?.estimatedRemainingMiles ?? route.estimatedRemainingMiles) || 0;
  const fuelTrueGal = clamp(
    (remainingMiles / Math.max(1, driver.weightedMpg)),
    0,
    vehicle.tank_capacity_gal
  );
  const gaugeNoise = ((rand() * 2) - 1) * (vehicle.gauge_noise_sd * vehicle.tank_capacity_gal);
  const fuelDisplayedGal = clamp(fuelTrueGal + gaugeNoise, 0, vehicle.tank_capacity_gal);
  const fuelDisplayPct = Math.round((fuelDisplayedGal / Math.max(1, vehicle.tank_capacity_gal)) * 100);
  return {
    true_fuel_gal: Math.round(fuelTrueGal * 100) / 100,
    observed_fuel_gal: Math.round(fuelDisplayedGal * 100) / 100,
    fuel_display_pct: fuelDisplayPct,
    true_range_buffer: remainingMiles,
  };
}

function estimateQueueMinutes(context, stationIndex) {
  const base = context.trafficLevel === 'gridlock'
    ? 8
    : (context.trafficLevel === 'congested' ? 5 : (context.trafficLevel === 'steady' ? 3 : 1));
  return Math.max(0, Math.round(base + (stationIndex * 1.5) + (context.weather === 'snow' ? 2 : 0)));
}

function estimateDetourMinutes(template, context, stationIndex, candidateCount) {
  const normalizedIndex = candidateCount > 1 ? stationIndex / (candidateCount - 1) : 0.5;
  const scenarioBase = template.scenario === 'highway' ? 4 : (template.scenario === 'city_grid' ? 6 : 3);
  return Math.round((scenarioBase + (normalizedIndex * 4) + (context.trafficLevel === 'gridlock' ? 3 : 0)) * 10) / 10;
}

function buildFactTablesForRoute({
  route,
  driver,
  household,
  person,
  vehicle,
  routeOrdinal,
  rand,
  fillTimestamp,
}) {
  const observedFuel = buildObservedFuelState(route, vehicle, driver, rand);
  const decisionId = `decision-${route.driverId}-${routeOrdinal}`;
  const visibleStations = (route.context?.visibleStationIds || []).map(findStationById).filter(Boolean);
  const plannedMilesNext24h = Math.round(
    (route.routeDistanceMiles * 1.4) +
    ((route.purpose.includes('commute') || route.purpose === 'pickup') ? 18 : 8)
  );
  const decisionEvent = {
    decision_id: decisionId,
    person_id: person.person_id,
    vehicle_id: vehicle.vehicle_id,
    household_id: household.household_id,
    timestamp: fillTimestamp,
    trip_context: route.context.exposureQuality,
    origin_zone: household.home_zone,
    destination_zone: `zone-${route.templateId}`,
    purpose: route.purpose,
    weather_bucket: route.context.weather,
    day_type: route.context.dayOfWeek === 0 || route.context.dayOfWeek === 6 ? 'weekend' : 'weekday',
    current_route_id: route.routeId,
    refuel_now_label: route.expectsTrigger ? 1 : 0,
    planned_miles_next_24h: plannedMilesNext24h,
    fuel_display_pct: observedFuel.fuel_display_pct,
    observed_range_miles: Math.round((observedFuel.observed_fuel_gal * driver.weightedMpg) * 10) / 10,
    observed_price_context: visibleStations.length ? 'seen_on_route' : 'not_seen',
    observed_visible_station_count: visibleStations.length,
    observed_last_station_id: (driver.preferredBrands[0] || null),
    true_fuel_gal: observedFuel.true_fuel_gal,
    true_next_required_miles_before_opportunity: Math.max(0, plannedMilesNext24h - route.routeDistanceMiles),
    true_queue_state: route.context.trafficLevel,
    true_planned_rest_of_day_purpose: route.purpose.includes('commute') ? 'homebound' : 'discretionary',
  };

  const candidateStations = visibleStations.map((station, stationIndex) => {
    const effectivePrice = Math.round(((Number(station.price) || 3.5) - ((driver.memberships.costco && station.brand === 'Costco') ? 0.05 : 0)) * 100) / 100;
    const detourMinutes = estimateDetourMinutes(
      { scenario: route.scenario },
      route.context,
      stationIndex,
      visibleStations.length
    );
    const queueMinutes = estimateQueueMinutes(route.context, stationIndex);
    const familiarityScore = clamp(Number(driver.stationAffinity[station.stationId]) || 0, 0, 1);
    return {
      decision_id: decisionId,
      station_id: station.stationId,
      chosen_label: station.stationId === route.targetStationId ? 1 : 0,
      effective_price: effectivePrice,
      detour_minutes: detourMinutes,
      extra_miles: Math.round((detourMinutes * (route.scenario === 'highway' ? 0.9 : 0.45)) * 10) / 10,
      queue_minutes: queueMinutes,
      station_open_flag: true,
      same_side_of_road_flag: stationIndex === 0 ? 1 : 0,
      brand_match_flag: driver.preferredBrands.some(brand => String(station.brand).includes(brand)) ? 1 : 0,
      loyalty_value: Math.round((((driver.memberships.costco && station.brand === 'Costco') || (driver.memberships.sams && station.brand === "Sam's Club")) ? 0.08 : 0) * 100) / 100,
      near_home_flag: station.brand === 'King Soopers' || station.brand === 'Shell' ? 1 : 0,
      near_work_flag: route.purpose.includes('commute') ? 1 : 0,
      amenity_score: station.brand === 'Pilot' || station.brand === "Love's" ? 0.8 : 0.5,
      familiarity_score: Math.round(familiarityScore * 1000) / 1000,
      visibility_score: Math.round((1 - (stationIndex / Math.max(1, visibleStations.length))) * 1000) / 1000,
      observed_price_age_minutes: Math.round((stationIndex + 1) * (route.context.trafficLevel === 'gridlock' ? 12 : 6)),
      fuel_compatible_flag: 1,
      observed_price: effectivePrice,
      true_actual_price: Number(station.price) || 3.5,
      true_queue_minutes: queueMinutes,
    };
  });

  const transaction = route.expectsTrigger && route.targetStationId
    ? {
      transaction_id: `txn-${route.driverId}-${routeOrdinal}`,
      decision_id: decisionId,
      station_id: route.targetStationId,
      timestamp: fillTimestamp,
      gallons_bought: Math.round(Math.max(4.0, Math.min(vehicle.tank_capacity_gal, vehicle.tank_capacity_gal - observedFuel.true_fuel_gal)) * 10) / 10,
      dollars_spent: Math.round((candidateStations.find(station => station.station_id === route.targetStationId)?.effective_price || 3.35) * Math.max(4.0, Math.min(vehicle.tank_capacity_gal, vehicle.tank_capacity_gal - observedFuel.true_fuel_gal)) * 100) / 100,
      grade_bought: vehicle.required_octane,
      fill_type: observedFuel.fuel_display_pct <= 25 ? 'fill_to_full' : (driver.cashConstraintLevel >= 0.65 ? 'target_dollars' : 'range_target'),
    }
    : null;

  return {
    decisionEvent,
    candidateStations,
    transaction,
    latentState: {
      true_fuel_gal: observedFuel.true_fuel_gal,
      true_range_buffer: decisionEvent.true_range_buffer,
      true_planned_miles_next_24h: plannedMilesNext24h,
      true_station_price_map: Object.fromEntries(candidateStations.map(candidate => [candidate.station_id, candidate.true_actual_price])),
      true_queue_minutes: Object.fromEntries(candidateStations.map(candidate => [candidate.station_id, candidate.true_queue_minutes])),
    },
    observedState: {
      fuel_display_pct: decisionEvent.fuel_display_pct,
      observed_range_miles: decisionEvent.observed_range_miles,
      observed_visible_station_ids: route.context.visibleStationIds.slice(),
      observed_price_map: Object.fromEntries(candidateStations.map(candidate => [candidate.station_id, candidate.observed_price])),
      observed_price_age_minutes: Object.fromEntries(candidateStations.map(candidate => [candidate.station_id, candidate.observed_price_age_minutes])),
    },
  };
}

function buildRealisticStressProfile(driver, historyLevel = 'none') {
  const now = Date.now();
  const topStations = [...GROUNDED_SIM_STATIONS]
    .sort((left, right) => (driver.stationAffinity[right.stationId] || 0) - (driver.stationAffinity[left.stationId] || 0))
    .slice(0, historyLevel === 'rich' ? 5 : (historyLevel === 'light' ? 3 : 1));
  const visitHistory = historyLevel === 'none'
    ? []
    : topStations.map((station, index) => {
      const visitCount = historyLevel === 'rich'
        ? Math.max(2, Math.round(2 + (driver.stationAffinity[station.stationId] * 14)))
        : (index === 0 ? 2 : 1);
      const spacingDays = historyLevel === 'rich' ? 4 : 7;
      const visitTimestamps = Array.from({ length: visitCount }, (_, visitIndex) =>
        now - ((index + 1 + (visitIndex * spacingDays)) * 86_400_000)
      );
      return {
        stationId: station.stationId,
        visitCount,
        lastVisitMs: visitTimestamps[0],
        visitTimestamps,
      };
    });
  const gallonsPerFill = Math.round(Math.max(8.5, driver.tankGallons * (0.58 + (driver.lowFuelConservatism * 0.16))) * 10) / 10;
  const fillUpHistory = Array.from({ length: historyLevel === 'rich' ? 4 : 2 }, (_, index) => ({
    timestamp: now - ((index + 1) * 5 * 86_400_000),
    odometer: 40120 - (index * driver.typicalIntervalMiles),
    gallons: gallonsPerFill,
    pricePerGallon: topStations[index % topStations.length]?.price || 3.35,
  })).reverse();
  const estimatedMilesSinceLastFill = Math.round(driver.typicalIntervalMiles * 0.58);

  return {
    preferredBrands: [...driver.preferredBrands],
    brandLoyalty: driver.brandLoyalty,
    typicalFillUpIntervalMiles: driver.typicalIntervalMiles,
    fillUpHistory,
    visitHistory,
    exposureHistory: [],
    estimatedMilesSinceLastFill,
    odometerMiles: 40480,
  };
}

const REALISTIC_HISTORY_BURN_IN_ROUTES = {
  none: 0,
  light: 60,
  rich: 180,
};
const REALISTIC_EVALUATION_ROUTE_INDEX_OFFSET = Math.max(...Object.values(REALISTIC_HISTORY_BURN_IN_ROUTES));

const REALISTIC_SIM_BASE_DATE_MS = Date.UTC(2026, 0, 5, 0, 0, 0);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

function buildDeterministicSimulationRand(baseSeed, routeIndex, phase = 0, driverIndex = 0) {
  const normalizedSeed = (
    (Number(baseSeed) || 0) +
    ((Number(driverIndex) || 0) * 100_003) +
    (Math.max(0, Number(routeIndex) || 0) * 9_973) +
    ((Number(phase) || 0) * 31_337)
  ) >>> 0;
  return mulberry32(normalizedSeed || 1);
}

function getRealisticHistoryBurnInRouteCount(historyLevel = 'none', overrides = null) {
  if (overrides && Number.isFinite(Number(overrides?.[historyLevel]))) {
    return Math.max(0, Math.round(Number(overrides[historyLevel])));
  }
  return REALISTIC_HISTORY_BURN_IN_ROUTES[historyLevel] || 0;
}

function buildSimulatedRouteTimestampMs(absoluteRouteIndex, routeHour = 8) {
  const normalizedHour = clamp(Number(routeHour) || 8, 0, 23);
  return (
    REALISTIC_SIM_BASE_DATE_MS +
    (Math.max(0, absoluteRouteIndex) * DAY_MS) +
    (normalizedHour * HOUR_MS) +
    ((absoluteRouteIndex % 5) * 7 * MINUTE_MS)
  );
}

function classifyVisitDaypart(hour) {
  const normalizedHour = Number.isFinite(Number(hour)) ? Number(hour) : 12;
  if (normalizedHour < 6) return 'night';
  if (normalizedHour < 11) return 'morning';
  if (normalizedHour < 16) return 'midday';
  if (normalizedHour < 21) return 'evening';
  return 'night';
}

function buildVisitContextCounts(visitTimestamp, visitContext = {}) {
  const timestampDate = new Date(visitTimestamp || Date.now());
  const dayOfWeek = Number.isFinite(Number(visitContext.dayOfWeek))
    ? Number(visitContext.dayOfWeek)
    : timestampDate.getDay();
  const hour = Number.isFinite(Number(visitContext.hour))
    ? Number(visitContext.hour)
    : timestampDate.getHours();
  const scenario = String(visitContext.scenario || '').toLowerCase();
  const counts = {
    total: 1,
    highway: 0,
    suburban: 0,
    city: 0,
    city_grid: 0,
    weekday: (dayOfWeek === 0 || dayOfWeek === 6) ? 0 : 1,
    weekend: (dayOfWeek === 0 || dayOfWeek === 6) ? 1 : 0,
    morning: 0,
    midday: 0,
    evening: 0,
    night: 0,
  };
  if (scenario === 'highway' || scenario === 'suburban' || scenario === 'city' || scenario === 'city_grid') {
    counts[scenario] = 1;
  }
  counts[classifyVisitDaypart(hour)] = 1;
  return counts;
}

function mergeVisitContextCounts(existingCounts = {}, nextCounts = {}) {
  return {
    total: (Number(existingCounts.total) || 0) + (Number(nextCounts.total) || 0),
    highway: (Number(existingCounts.highway) || 0) + (Number(nextCounts.highway) || 0),
    suburban: (Number(existingCounts.suburban) || 0) + (Number(nextCounts.suburban) || 0),
    city: (Number(existingCounts.city) || 0) + (Number(nextCounts.city) || 0),
    city_grid: (Number(existingCounts.city_grid) || 0) + (Number(nextCounts.city_grid) || 0),
    weekday: (Number(existingCounts.weekday) || 0) + (Number(nextCounts.weekday) || 0),
    weekend: (Number(existingCounts.weekend) || 0) + (Number(nextCounts.weekend) || 0),
    morning: (Number(existingCounts.morning) || 0) + (Number(nextCounts.morning) || 0),
    midday: (Number(existingCounts.midday) || 0) + (Number(nextCounts.midday) || 0),
    evening: (Number(existingCounts.evening) || 0) + (Number(nextCounts.evening) || 0),
    night: (Number(existingCounts.night) || 0) + (Number(nextCounts.night) || 0),
  };
}

function recordProfileVisit(profile, stationId, visitTimestamp, visitContext = null) {
  if (!profile || !stationId) return;
  const nextContextCounts = buildVisitContextCounts(visitTimestamp, visitContext || {});
  const existing = profile.visitHistory.find(entry => entry.stationId === stationId);
  if (existing) {
    existing.visitCount += 1;
    existing.lastVisitMs = visitTimestamp;
    existing.visitTimestamps = existing.visitTimestamps || [];
    existing.visitTimestamps.push(visitTimestamp);
    existing.contextCounts = mergeVisitContextCounts(existing.contextCounts, nextContextCounts);
  } else {
    profile.visitHistory.push({
      stationId,
      visitCount: 1,
      lastVisitMs: visitTimestamp,
      visitTimestamps: [visitTimestamp],
      contextCounts: nextContextCounts,
    });
  }
}

function recordProfileExposure(profile, stationId, exposureTimestamp, exposureContext = null) {
  if (!profile || !stationId) return;
  if (!Array.isArray(profile.exposureHistory)) {
    profile.exposureHistory = [];
  }
  const nextContextCounts = buildVisitContextCounts(exposureTimestamp, exposureContext || {});
  const existing = profile.exposureHistory.find(entry => entry.stationId === stationId);
  if (existing) {
    existing.exposureCount = (Number(existing.exposureCount) || 0) + 1;
    existing.lastExposureMs = exposureTimestamp;
    existing.contextCounts = mergeVisitContextCounts(existing.contextCounts, nextContextCounts);
  } else {
    profile.exposureHistory.push({
      stationId,
      exposureCount: 1,
      lastExposureMs: exposureTimestamp,
      contextCounts: nextContextCounts,
    });
  }
}

function recordRouteStationExposure(profile, route, exposureTimestamp) {
  const visibleStationIds = Array.isArray(route?.context?.visibleStationIds)
    ? route.context.visibleStationIds
    : [];
  if (!visibleStationIds.length) return;
  for (const stationId of visibleStationIds) {
    recordProfileExposure(profile, stationId, exposureTimestamp, {
      scenario: route?.scenario || route?.context?.scenario || null,
      dayOfWeek: route?.context?.dayOfWeek,
      hour: route?.context?.hour,
    });
  }
}

function applyFuelingOutcomeToProfile({
  profile,
  route,
  driver,
  odometerMiles,
  milesSinceLastFill,
  fillTimestamp,
  mutateVisitHistory = true,
}) {
  let nextMilesSinceLastFill = milesSinceLastFill + route.routeDistanceMiles;
  const nextOdometerMiles = odometerMiles + route.routeDistanceMiles;

  recordRouteStationExposure(profile, route, fillTimestamp);

  if (route.expectsTrigger && route.targetStationId) {
    const gallons = Math.round(
      Math.max(
        7.8,
        Math.min(driver.tankGallons, (driver.tankGallons * (0.48 + (driver.lowFuelConservatism * 0.22))))
      ) * 10
    ) / 10;
    profile.fillUpHistory.push({
      timestamp: fillTimestamp,
      odometer: nextOdometerMiles,
      gallons,
      pricePerGallon: findStationById(route.targetStationId)?.price || 3.35,
    });
    if (mutateVisitHistory) {
      recordProfileVisit(profile, route.targetStationId, fillTimestamp, {
        scenario: route?.scenario || route?.context?.scenario || null,
        dayOfWeek: route?.context?.dayOfWeek,
        hour: route?.context?.hour,
      });
    }
    nextMilesSinceLastFill = 0;
  }

  profile.estimatedMilesSinceLastFill = nextMilesSinceLastFill;
  profile.odometerMiles = nextOdometerMiles;

  return {
    odometerMiles: nextOdometerMiles,
    milesSinceLastFill: nextMilesSinceLastFill,
  };
}

function applyRealisticHistoryBurnIn({
  driver,
  profile,
  routeBuilder,
  burnInRouteCount,
  routeIndexOffset = 0,
  driverIndex = 0,
}) {
  let milesSinceLastFill = Number(profile.estimatedMilesSinceLastFill) || 0;
  let odometerMiles = Number(profile.odometerMiles) || 40000;

  for (let burnInIndex = 0; burnInIndex < burnInRouteCount; burnInIndex += 1) {
    const absoluteRouteIndex = routeIndexOffset + burnInIndex;
    const route = routeBuilder({
      profile,
      routeIndex: absoluteRouteIndex,
      milesSinceLastFill,
      driverIndex,
    });
    const fillTimestamp = buildSimulatedRouteTimestampMs(
      absoluteRouteIndex,
      route?.context?.hour ?? route?.overrideTime?.hour ?? 8
    );
    const nextState = applyFuelingOutcomeToProfile({
      profile,
      route,
      driver,
      odometerMiles,
      milesSinceLastFill,
      fillTimestamp,
      mutateVisitHistory: true,
    });
    odometerMiles = nextState.odometerMiles;
    milesSinceLastFill = nextState.milesSinceLastFill;
  }

  return {
    profile,
    burnInRouteCount,
    historySpanDays: burnInRouteCount,
    odometerMiles,
    milesSinceLastFill,
  };
}

function chooseTemplateForDriver(rand, driver, routeIndex) {
  const dayOfWeek = routeIndex % 7;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const weighted = REALISTIC_ROUTE_TEMPLATES.map(template => {
    let weight = isWeekend ? template.weekendWeight : template.weekdayWeight;
    if (!isWeekend && template.purpose === 'commute') {
      weight += driver.weekdayRoutineStrength * 0.22;
    }
    if (isWeekend && ['shopping', 'errand'].includes(template.purpose)) {
      weight += driver.weekendErrandShare * 0.18;
    }
    if (template.scenario === 'highway') {
      weight += driver.highwayShare * 0.20;
    }
    if (template.scenario !== 'highway') {
      weight += (1 - driver.highwayShare) * 0.06;
    }
    if (driver.memberships.costco && getTemplateStationMarket(template).some(station => station.brand === 'Costco')) {
      weight += 0.06;
    }
    return { item: template, weight };
  });
  const template = chooseWeighted(rand, weighted) || REALISTIC_ROUTE_TEMPLATES[0];
  return {
    template,
    dayOfWeek,
    hour: isWeekend
      ? Math.max(9, template.defaultHour)
      : template.defaultHour,
  };
}

function buildRealisticRoute({
  rand,
  driver,
  profile,
  routeIndex,
  milesSinceLastFill,
}) {
  const { template, dayOfWeek, hour } = chooseTemplateForDriver(rand, driver, routeIndex);
  const templateCandidateStationIds = getTemplateCandidateStationIds(template);
  const templateStationMarket = getTemplateStationMarket(template);
  const baseWaypoints = buildWaypointsFromGroundedRoute({
    ...template,
    candidateStationIds: templateCandidateStationIds,
  }, 5);
  const fuelStateBefore = estimateFuelState(profile.fillUpHistory, {
    milesSinceLastFill,
    typicalIntervalMiles: driver.typicalIntervalMiles,
  });
  const remainingMiles = fuelStateBefore.estimatedRemainingMiles;
  const routeDistanceMiles = routeDistanceMilesFromWaypoints(baseWaypoints);
  const candidateStations = templateStationMarket;
  const routeConsumptionPressure = clamp(routeDistanceMiles / Math.max(1, driver.typicalIntervalMiles), 0, 1);
  const remainingRatio = clamp(remainingMiles / Math.max(1, driver.typicalIntervalMiles), 0, 2);
  const lowFuelNeed = clamp(1 - remainingRatio, 0, 1);
  const opportunityValue = candidateStations.length
    ? candidateStations
      .map((station, stationIndex) => scoreDriverStationAffinity(driver, station, template, stationIndex, candidateStations.length))
      .reduce((maxValue, value) => Math.max(maxValue, value), 0)
    : 0;
  const membershipOpportunity = candidateStations.some(station => (
    (driver.memberships.costco && station.brand === 'Costco') ||
    (driver.memberships.sams && station.brand === "Sam's Club")
  )) ? 1 : 0;
  const earlyFuelCap = remainingRatio >= 0.90
    ? (0.02 + (membershipOpportunity * 0.02))
    : remainingRatio >= 0.72
      ? (0.05 + (membershipOpportunity * 0.02))
      : remainingRatio >= 0.55
        ? 0.12
        : 0.92;
  const stopProbability = clamp(
    (driver.spontaneity * 0.14) +
    (lowFuelNeed * (0.42 + (driver.lowFuelConservatism * 0.12))) +
    (routeConsumptionPressure * 0.05) +
    (Math.max(0, lowFuelNeed - 0.34) * opportunityValue * 0.14) +
    (membershipOpportunity * Math.max(0, lowFuelNeed - 0.22) * 0.05) +
    (template.scenario === 'highway' ? 0.02 : 0),
    0.002,
    earlyFuelCap
  );
  const willStop = rand() < stopProbability;
  const destinationStationId = willStop
    ? chooseWeighted(rand, candidateStations.map((station, stationIndex) => ({
      item: station.stationId,
      weight: scoreDriverStationAffinity(driver, station, template, stationIndex, candidateStations.length) +
        (lowFuelNeed * 0.18) +
        (template.scenario === 'highway' ? ((1 - (stationIndex / Math.max(1, candidateStations.length - 1))) * 0.18) : 0),
    })))
    : null;
  const hiddenDecisionLowerBound = Math.max(4, Math.floor(baseWaypoints.length * (remainingMiles <= 45 ? 0.24 : 0.36)));
  const hiddenDecisionUpperBound = Math.max(hiddenDecisionLowerBound + 1, Math.floor(baseWaypoints.length * (remainingMiles <= 45 ? 0.54 : 0.76)));
  const hiddenDecisionIndex = willStop
    ? randomInt(rand, hiddenDecisionLowerBound, hiddenDecisionUpperBound)
    : null;
  const route = buildHiddenIntentRoute({
    blueprint: {
      id: template.id,
      groundedRouteId: template.id,
      scenario: template.scenario,
      defaultHour: hour,
      dayOfWeek,
      hiddenFuelProbability: stopProbability,
      candidateStationIds: templateCandidateStationIds,
      controlPoints: template.controlPoints,
      speedFns: template.speedFns,
    },
    routeIndex,
    rand,
    willStopOverride: willStop,
    destinationStationIdOverride: destinationStationId,
    hiddenDecisionIndexOverride: hiddenDecisionIndex,
  });
  route.templateId = template.id;
  route.purpose = template.purpose;
  route.startingMilesSinceLastFill = Math.round(milesSinceLastFill);
  route.fuelStateBefore = fuelStateBefore;
  route.intentClass = remainingMiles <= 100 ? 'probable' : 'impulsive';
  route.routeDistanceMiles = Math.round(routeDistanceMiles * 10) / 10;
  route.marketStations = templateStationMarket;
  return route;
}

function simulateRealisticHiddenIntentBatch({
  createEngineFn,
  applyNoise = true,
  noiseSeed = 2026,
  routeCount = 96,
  historyLevel = 'none',
  latentPlanHistoryLevel = 'none',
  freezeVisitHistory = true,
  collectRouteEvents = false,
} = {}) {
  if (typeof createEngineFn !== 'function') {
    throw new Error('simulateRealisticHiddenIntentBatch requires a createEngineFn');
  }

  const driver = buildRealisticDriverSpec({ seed: noiseSeed, historyLevel });
  const baseSeedProfile = buildRealisticStressProfile(driver, 'none');
  const burnInRouteCount = getRealisticHistoryBurnInRouteCount(historyLevel);
  const burnedInProfile = applyRealisticHistoryBurnIn({
    driver,
    profile: cloneProfile(baseSeedProfile),
    burnInRouteCount,
    routeBuilder: ({ profile: burnInProfile, routeIndex, milesSinceLastFill }) => buildRealisticRoute({
      rand: buildDeterministicSimulationRand(noiseSeed, routeIndex, 1),
      driver,
      profile: burnInProfile,
      routeIndex,
      milesSinceLastFill,
    }),
  });
  const seedProfile = burnedInProfile.profile;
  const profile = cloneProfile(seedProfile);
  const latentPlanProfile = cloneProfile(buildRealisticStressProfile(driver, latentPlanHistoryLevel === 'none' ? 'none' : latentPlanHistoryLevel));
  const routeResults = [];
  let milesSinceLastFill = Number(profile.estimatedMilesSinceLastFill) || burnedInProfile.milesSinceLastFill || 0;
  let odometerMiles = Number(profile.odometerMiles) || burnedInProfile.odometerMiles || 40000;
  let latentMilesSinceLastFill = Number(latentPlanProfile.estimatedMilesSinceLastFill) || 0;
  let latentOdometerMiles = Number(latentPlanProfile.odometerMiles) || 40000;

  for (let index = 0; index < routeCount; index += 1) {
    const absoluteRouteIndex = REALISTIC_EVALUATION_ROUTE_INDEX_OFFSET + index;
    const route = buildRealisticRoute({
      rand: buildDeterministicSimulationRand(noiseSeed, absoluteRouteIndex, 2),
      driver,
      profile: latentPlanProfile,
      routeIndex: absoluteRouteIndex,
      milesSinceLastFill: latentMilesSinceLastFill,
    });
    const historyVisitCount = profile.visitHistory.reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0);
    const triggers = [];
    const engine = createEngineFn({
      profile,
      onTrigger: event => triggers.push(event),
    });
    if (typeof engine?.setStations === 'function') {
      engine.setStations((route.marketStations || []).length ? route.marketStations : GROUNDED_SIM_STATIONS);
    }
    const samples = routeToSamples(route);
    const noisyRun = applyNoise
      ? addDrivingNoise(samples, {
        seed: noiseSeed + index,
        returnMetadata: true,
        stopProbability: route.scenario === 'highway' ? 0.10 : (route.scenario === 'city_grid' ? 0.84 : 0.58),
        stopIntervalM: route.scenario === 'highway' ? 2200 : (route.scenario === 'city_grid' ? 230 : 420),
        skipStopsAboveSpeed: route.scenario === 'highway' ? 26 : 18,
      })
      : { samples, noiseEvents: [] };

    for (const sample of noisyRun.samples) {
      engine.pushLocation(sample);
    }

    const firstTrigger = triggers[0] || null;
    const matchedTrigger = route.targetStationId
      ? triggers.find(trigger => trigger.stationId === route.targetStationId)
      : null;
    const triggered = triggers.length > 0;
    const firstTriggerCorrect = Boolean(firstTrigger && route.targetStationId && firstTrigger.stationId === route.targetStationId);
    const triggerDistance = matchedTrigger?.triggerDistance ??
      matchedTrigger?.forwardDistance ??
      firstTrigger?.triggerDistance ??
      firstTrigger?.forwardDistance ??
      null;
    const correct = route.expectsTrigger ? firstTriggerCorrect : !triggered;

    routeResults.push({
      routeId: route.id,
      templateId: route.templateId,
      purpose: route.purpose,
      scenario: route.scenario,
      intentClass: route.intentClass,
      expectsTrigger: route.expectsTrigger,
      triggered,
      firstTriggerCorrect,
      triggerDistance,
      triggeredStationId: firstTrigger?.stationId || null,
      targetStationId: route.targetStationId,
      groundedStationCount: (route.marketStations || []).length,
      groundedRoutePointCount: Array.isArray(route.waypoints) ? route.waypoints.length : 0,
      hiddenDecisionIndex: route.hiddenDecisionIndex,
      startingMilesSinceLastFill: route.startingMilesSinceLastFill,
      estimatedRemainingMiles: route.fuelStateBefore?.estimatedRemainingMiles ?? null,
      routeDistanceMiles: route.routeDistanceMiles,
      historyCount: historyVisitCount,
      historyLevelAtStart: historyLevel,
      observedHistoryBucketAtStart: classifyHistoryLevel(historyVisitCount),
      correct,
      stopSignCount: noisyRun.noiseEvents.filter(event => event.type === 'stop_sign').length,
      trafficLightCount: noisyRun.noiseEvents.filter(event => event.type === 'traffic_light').length,
      ...(collectRouteEvents
        ? {
          routeEvents: triggers.map(event => ({ ...event })),
        }
        : {}),
    });

    const fillTimestamp = buildSimulatedRouteTimestampMs(
      absoluteRouteIndex,
      route?.overrideTime?.hour ?? 8
    );
    const nextObservedState = applyFuelingOutcomeToProfile({
      profile,
      route,
      driver,
      odometerMiles,
      milesSinceLastFill,
      fillTimestamp,
      mutateVisitHistory: !freezeVisitHistory,
    });
    odometerMiles = nextObservedState.odometerMiles;
    milesSinceLastFill = nextObservedState.milesSinceLastFill;

    const nextLatentState = applyFuelingOutcomeToProfile({
      profile: latentPlanProfile,
      route,
      driver,
      odometerMiles: latentOdometerMiles,
      milesSinceLastFill: latentMilesSinceLastFill,
      fillTimestamp,
      mutateVisitHistory: false,
    });
    latentOdometerMiles = nextLatentState.odometerMiles;
    latentMilesSinceLastFill = nextLatentState.milesSinceLastFill;
  }

  const noFuelRoutes = routeResults.filter(route => !route.expectsTrigger);
  const hiddenIntentRoutes = routeResults.filter(route => route.expectsTrigger);
  const truePositives = hiddenIntentRoutes.filter(route => route.firstTriggerCorrect).length;
  const falsePositives = noFuelRoutes.filter(route => route.triggered).length;
  const wrongStationTriggers = hiddenIntentRoutes.filter(route => route.triggered && !route.firstTriggerCorrect).length;
  const correctCount = routeResults.filter(route => route.correct).length;
  const triggerDistances = hiddenIntentRoutes
    .filter(route => route.firstTriggerCorrect && route.triggerDistance != null)
    .map(route => route.triggerDistance);

  const scenarioBuckets = {};
  for (const route of routeResults) {
    if (!scenarioBuckets[route.scenario]) {
      scenarioBuckets[route.scenario] = [];
    }
    scenarioBuckets[route.scenario].push(route);
  }
  const scenarioBreakdown = Object.fromEntries(
    Object.entries(scenarioBuckets).map(([scenario, routesForScenario]) => [
      scenario,
      summarizeStressBucket(routesForScenario),
    ])
  );
  const historyBuckets = {
    none: null,
    light: null,
    rich: null,
  };
  for (const bucketLabel of Object.keys(historyBuckets)) {
    const bucketRoutes = routeResults.filter(route => route.historyLevelAtStart === bucketLabel);
    if (!bucketRoutes.length) {
      continue;
    }
    const bucketNoFuel = bucketRoutes.filter(route => !route.expectsTrigger);
    const bucketHidden = bucketRoutes.filter(route => route.expectsTrigger);
    historyBuckets[bucketLabel] = buildUnifiedScorecard({
      totalCount: bucketRoutes.length,
      correctCount: bucketRoutes.filter(route => route.correct).length,
      tp: bucketHidden.filter(route => route.firstTriggerCorrect).length,
      fp: bucketNoFuel.filter(route => route.triggered).length,
      fn: bucketHidden.filter(route => !route.firstTriggerCorrect).length,
      tn: bucketNoFuel.filter(route => !route.triggered).length,
      wrongStationTriggers: bucketHidden.filter(route => route.triggered && !route.firstTriggerCorrect).length,
      triggerDistances: bucketHidden
        .filter(route => route.firstTriggerCorrect && route.triggerDistance != null)
        .map(route => route.triggerDistance),
      historyBuckets: null,
    });
  }

  const scorecard = buildUnifiedScorecard({
    totalCount: routeResults.length,
    correctCount,
    tp: truePositives,
    fp: falsePositives,
    fn: hiddenIntentRoutes.length - truePositives,
    tn: noFuelRoutes.length - falsePositives,
    wrongStationTriggers,
    triggerDistances,
    historyBuckets,
  });

  return {
    historyLevel,
    routeCount,
    burnInRouteCount,
    historySpanDays: burnInRouteCount,
    evaluationRouteIndexOffset: REALISTIC_EVALUATION_ROUTE_INDEX_OFFSET,
    driver,
    seedProfile: cloneProfile(seedProfile),
    routes: routeResults,
    summary: {
      accuracy: scorecard.accuracy,
      hiddenIntentRecall: scorecard.recall,
      precision: scorecard.precision,
      recall: scorecard.recall,
      silentRateWhenNoFuel: scorecard.silentRateWhenNoFuel,
      falsePositiveRate: scorecard.falsePositiveRate,
      wrongStationRate: scorecard.wrongStationRate,
      hiddenIntentCount: scorecard.hiddenIntentCount,
      noFuelCount: scorecard.noFuelCount,
      avgCorrectTriggerDistanceMeters: scorecard.avgCorrectTriggerDistanceMeters,
      precisionFirstScore: scorecard.precisionFirstScore,
      scorecard,
      historyBuckets,
      scenarioBreakdown,
    },
  };
}

function buildRealisticCohortRoute({
  rand,
  driver,
  profile,
  routeIndex,
  driverIndex,
  milesSinceLastFill,
}) {
  const { template, dayOfWeek, hour } = chooseTemplateForDriver(rand, driver, routeIndex);
  const context = buildRealisticTripContext({
    rand,
    driver,
    template,
    routeIndex,
    dayOfWeek,
    hour,
  });
  const templateCandidateStationIds = getTemplateCandidateStationIds(template);
  const templateStationMarket = getTemplateStationMarket(template);
  const baseWaypoints = buildWaypointsFromGroundedRoute({
    ...template,
    candidateStationIds: templateCandidateStationIds,
  }, 5);
  const fuelStateBefore = estimateFuelState(profile.fillUpHistory, {
    milesSinceLastFill,
    typicalIntervalMiles: driver.typicalIntervalMiles,
  });
  const remainingMiles = fuelStateBefore.estimatedRemainingMiles;
  const routeDistanceMiles = routeDistanceMilesFromWaypoints(baseWaypoints);
  const routeConsumptionPressure = clamp(routeDistanceMiles / Math.max(1, driver.typicalIntervalMiles), 0, 1);
  const remainingRatio = clamp(remainingMiles / Math.max(1, driver.typicalIntervalMiles), 0, 2);
  const lowFuelNeed = clamp(1 - remainingRatio, 0, 1);
  const exposure = buildRouteExposure(templateCandidateStationIds, rand, template, context);
  const visibleStations = exposure.visibleStationIds.map(findStationById).filter(Boolean);

  const weatherPenalty = context.weather === 'snow'
    ? 0.10
    : (context.weather === 'rain' ? 0.05 : 0);
  const trafficPenalty = context.trafficLevel === 'gridlock'
    ? 0.08
    : (context.trafficLevel === 'congested' ? 0.04 : 0);
  const stopProbability = clamp(
    (driver.spontaneity * 0.10) +
    (lowFuelNeed * (0.48 + (driver.lowFuelConservatism * 0.18))) +
    (Math.max(0, lowFuelNeed - 0.24) * context.cheapnessBias * 0.12) +
    (routeConsumptionPressure * 0.06) +
    ((context.weather === 'snow' || context.weather === 'rain') ? (driver.weatherSensitivity * 0.08) : 0) +
    (template.scenario === 'highway' ? 0.03 : 0) -
    trafficPenalty -
    (context.timePressure * 0.04),
    0.001,
    remainingRatio >= 0.95 ? 0.03 : remainingRatio >= 0.75 ? 0.08 : remainingRatio >= 0.58 ? 0.16 : 0.94
  );
  const willStop = rand() < stopProbability;
  const chosenStationId = willStop && visibleStations.length
    ? chooseWeighted(rand, visibleStations.map((station, stationIndex) => ({
      item: station.stationId,
      weight: scoreCohortStationChoice(
        driver,
        station,
        template,
        context,
        remainingMiles,
        stationIndex,
        visibleStations.length
      ),
    })))
    : null;
  const hiddenDecisionLowerBound = Math.max(4, Math.floor(baseWaypoints.length * (remainingMiles <= 50 ? 0.26 : 0.38)));
  const hiddenDecisionUpperBound = Math.max(hiddenDecisionLowerBound + 1, Math.floor(baseWaypoints.length * (remainingMiles <= 50 ? 0.58 : 0.78)));
  const hiddenDecisionIndex = willStop
    ? randomInt(rand, hiddenDecisionLowerBound, hiddenDecisionUpperBound)
    : null;
  const route = buildHiddenIntentRoute({
    blueprint: {
      id: template.id,
      groundedRouteId: template.id,
      scenario: template.scenario,
      defaultHour: hour,
      dayOfWeek,
      hiddenFuelProbability: stopProbability,
      candidateStationIds: exposure.visibleStationIds,
      controlPoints: template.controlPoints,
      speedFns: template.speedFns,
    },
    routeIndex: (driverIndex * 10_000) + routeIndex,
    rand,
    willStopOverride: willStop,
    destinationStationIdOverride: chosenStationId,
    hiddenDecisionIndexOverride: hiddenDecisionIndex,
  });
  route.templateId = template.id;
  route.purpose = template.purpose;
  route.driverId = `driver-${driverIndex}`;
  route.driverArchetype = driver.archetype;
  route.routeDistanceMiles = Math.round(routeDistanceMiles * 10) / 10;
  route.marketStations = templateStationMarket;
  route.startingMilesSinceLastFill = Math.round(milesSinceLastFill);
  route.fuelStateBefore = fuelStateBefore;
  route.intentClass = remainingMiles <= 100 ? 'probable' : 'impulsive';
  route.context = {
    ...context,
    dayOfWeek,
    hour,
    visibleStationIds: exposure.visibleStationIds.slice(),
    visibleStationCount: exposure.visibleStationCount,
    exposureQuality: exposure.exposureQuality,
    routeConsumptionPressure: Math.round(routeConsumptionPressure * 1000) / 1000,
    stopProbability: Math.round(stopProbability * 1000) / 1000,
    weatherPenalty,
  };
  return route;
}

function simulateRealisticCohortBatch({
  createEngineFn,
  applyNoise = true,
  noiseSeed = 2026,
  driverCount = 6,
  routesPerDriver = 28,
  historyLevel = 'none',
  latentPlanHistoryLevel = 'none',
  freezeVisitHistory = true,
  collectRouteEvents = false,
} = {}) {
  if (typeof createEngineFn !== 'function') {
    throw new Error('simulateRealisticCohortBatch requires a createEngineFn');
  }

  const routeResults = [];
  const drivers = [];
  const households = [];
  const persons = [];
  const vehicles = [];
  const decision_events = [];
  const candidate_stations = [];
  const transactions = [];
  const daily_vehicle_summary = [];
  const purposeDistribution = {};
  const trafficDistribution = {};
  const weatherDistribution = {};
  const occupancyDistribution = {};
  const archetypeDistribution = {};

  for (let driverIndex = 0; driverIndex < driverCount; driverIndex += 1) {
    const driverSeed = noiseSeed + (driverIndex * 997);
    const driver = buildRealisticDriverSpec({ seed: driverSeed, historyLevel });
    const baseSeedProfile = buildRealisticStressProfile(driver, 'none');
    const burnInRouteCount = getRealisticHistoryBurnInRouteCount(historyLevel);
    const burnedInProfile = applyRealisticHistoryBurnIn({
      driver,
      profile: cloneProfile(baseSeedProfile),
      burnInRouteCount,
      routeIndexOffset: 0,
      driverIndex,
      routeBuilder: ({ profile: burnInProfile, routeIndex, milesSinceLastFill, driverIndex: historicalDriverIndex }) => buildRealisticCohortRoute({
        rand: buildDeterministicSimulationRand(driverSeed, routeIndex, 3, historicalDriverIndex),
        driver,
        profile: burnInProfile,
        routeIndex,
        driverIndex: historicalDriverIndex,
        milesSinceLastFill,
      }),
    });
    const seedProfile = burnedInProfile.profile;
    const profile = cloneProfile(seedProfile);
    const latentPlanProfile = cloneProfile(buildRealisticStressProfile(driver, latentPlanHistoryLevel === 'none' ? 'none' : latentPlanHistoryLevel));
    const household = buildHouseholdRecord(driver, driverIndex);
    const person = buildPersonRecord(driver, driverIndex, household);
    const vehicle = buildVehicleRecord(driver, driverIndex, household, person);
    households.push(household);
    persons.push(person);
    vehicles.push(vehicle);
    let milesSinceLastFill = Number(profile.estimatedMilesSinceLastFill) || burnedInProfile.milesSinceLastFill || 0;
    let odometerMiles = Number(profile.odometerMiles) || burnedInProfile.odometerMiles || 40000;
    let latentMilesSinceLastFill = Number(latentPlanProfile.estimatedMilesSinceLastFill) || 0;
    let latentOdometerMiles = Number(latentPlanProfile.odometerMiles) || 40000;

    const driverRoutes = [];

    for (let routeIndex = 0; routeIndex < routesPerDriver; routeIndex += 1) {
      const absoluteRouteIndex = REALISTIC_EVALUATION_ROUTE_INDEX_OFFSET + routeIndex;
      const route = buildRealisticCohortRoute({
        rand: buildDeterministicSimulationRand(driverSeed, absoluteRouteIndex, 4, driverIndex),
        driver,
        profile: latentPlanProfile,
        routeIndex: absoluteRouteIndex,
        driverIndex,
        milesSinceLastFill: latentMilesSinceLastFill,
      });
      const historyVisitCount = profile.visitHistory.reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0);
      const triggers = [];
      const engine = createEngineFn({
        profile,
        onTrigger: event => triggers.push(event),
      });
      if (typeof engine?.setStations === 'function') {
        engine.setStations((route.marketStations || []).length ? route.marketStations : GROUNDED_SIM_STATIONS);
      }
      const samples = routeToSamples(route);
      const noisyRun = applyNoise
        ? addDrivingNoise(samples, {
          seed: driverSeed + routeIndex,
          returnMetadata: true,
          stopProbability: route.scenario === 'highway' ? 0.10 : (route.scenario === 'city_grid' ? 0.88 : 0.60),
          stopIntervalM: route.scenario === 'highway' ? 2400 : (route.scenario === 'city_grid' ? 220 : 430),
          skipStopsAboveSpeed: route.scenario === 'highway' ? 26 : 18,
        })
        : { samples, noiseEvents: [] };

      for (const sample of noisyRun.samples) {
        engine.pushLocation(sample);
      }

      const firstTrigger = triggers[0] || null;
      const matchedTrigger = route.targetStationId
        ? triggers.find(trigger => trigger.stationId === route.targetStationId)
        : null;
      const triggered = triggers.length > 0;
      const firstTriggerCorrect = Boolean(firstTrigger && route.targetStationId && firstTrigger.stationId === route.targetStationId);
      const triggerDistance = matchedTrigger?.triggerDistance ??
        matchedTrigger?.forwardDistance ??
        firstTrigger?.triggerDistance ??
        firstTrigger?.forwardDistance ??
        null;
      const correct = route.expectsTrigger ? firstTriggerCorrect : !triggered;

      const result = {
        routeId: route.id,
        householdId: household.household_id,
        personId: person.person_id,
        vehicleId: vehicle.vehicle_id,
        driverId: route.driverId,
        driverArchetype: route.driverArchetype,
        templateId: route.templateId,
        purpose: route.purpose,
        scenario: route.scenario,
        intentClass: route.intentClass,
        expectsTrigger: route.expectsTrigger,
        triggered,
        firstTriggerCorrect,
        triggerDistance,
        triggeredStationId: firstTrigger?.stationId || null,
        targetStationId: route.targetStationId,
        groundedStationCount: (route.marketStations || []).length,
        groundedRoutePointCount: Array.isArray(route.waypoints) ? route.waypoints.length : 0,
        hiddenDecisionIndex: route.hiddenDecisionIndex,
        startingMilesSinceLastFill: route.startingMilesSinceLastFill,
        estimatedRemainingMiles: route.fuelStateBefore?.estimatedRemainingMiles ?? null,
        routeDistanceMiles: route.routeDistanceMiles,
        historyCount: historyVisitCount,
        historyLevelAtStart: historyLevel,
        observedHistoryBucketAtStart: classifyHistoryLevel(historyVisitCount),
        correct,
        stopSignCount: noisyRun.noiseEvents.filter(event => event.type === 'stop_sign').length,
        trafficLightCount: noisyRun.noiseEvents.filter(event => event.type === 'traffic_light').length,
        context: route.context,
        ...(collectRouteEvents
          ? {
            routeEvents: triggers.map(event => ({ ...event })),
          }
          : {}),
      };
      routeResults.push(result);
      driverRoutes.push(result);

      const fillTimestamp = buildSimulatedRouteTimestampMs(
        absoluteRouteIndex,
        route?.context?.hour ?? 8
      );
      const facts = buildFactTablesForRoute({
        route: result,
        driver,
        household,
        person,
        vehicle,
        routeOrdinal: routeIndex,
        rand: buildDeterministicSimulationRand(driverSeed, absoluteRouteIndex, 5, driverIndex),
        fillTimestamp,
      });
      result.decisionId = facts.decisionEvent.decision_id;
      result.latentState = facts.latentState;
      result.observedState = facts.observedState;
      result.candidateStationCount = facts.candidateStations.length;
      decision_events.push(facts.decisionEvent);
      candidate_stations.push(...facts.candidateStations);
      if (facts.transaction) {
        transactions.push(facts.transaction);
      }
      daily_vehicle_summary.push({
        vehicle_id: vehicle.vehicle_id,
        date: new Date(fillTimestamp).toISOString().slice(0, 10),
        miles_driven: route.routeDistanceMiles,
        gallons_burned: Math.round((route.routeDistanceMiles / Math.max(1, driver.weightedMpg)) * 100) / 100,
        fills_count: route.expectsTrigger ? 1 : 0,
        gallons_bought_total: facts.transaction?.gallons_bought || 0,
        stations_passed_count: route.context.visibleStationCount || 0,
      });

      purposeDistribution[result.purpose] = (purposeDistribution[result.purpose] || 0) + 1;
      trafficDistribution[result.context.trafficLevel] = (trafficDistribution[result.context.trafficLevel] || 0) + 1;
      weatherDistribution[result.context.weather] = (weatherDistribution[result.context.weather] || 0) + 1;
      occupancyDistribution[result.context.occupancy] = (occupancyDistribution[result.context.occupancy] || 0) + 1;
      archetypeDistribution[result.driverArchetype] = (archetypeDistribution[result.driverArchetype] || 0) + 1;

      const nextObservedState = applyFuelingOutcomeToProfile({
        profile,
        route,
        driver,
        odometerMiles,
        milesSinceLastFill,
        fillTimestamp,
        mutateVisitHistory: !freezeVisitHistory,
      });
      odometerMiles = nextObservedState.odometerMiles;
      milesSinceLastFill = nextObservedState.milesSinceLastFill;

      const nextLatentState = applyFuelingOutcomeToProfile({
        profile: latentPlanProfile,
        route,
        driver,
        odometerMiles: latentOdometerMiles,
        milesSinceLastFill: latentMilesSinceLastFill,
        fillTimestamp,
        mutateVisitHistory: false,
      });
      latentOdometerMiles = nextLatentState.odometerMiles;
      latentMilesSinceLastFill = nextLatentState.milesSinceLastFill;
    }

    drivers.push({
      driverId: `driver-${driverIndex}`,
      archetype: driver.archetype,
      workMode: driver.workMode,
      memberships: { ...driver.memberships },
      preferredBrands: [...driver.preferredBrands],
      tankGallons: driver.tankGallons,
      typicalIntervalMiles: driver.typicalIntervalMiles,
      familyLoad: driver.familyLoad,
      nightDrivingShare: driver.nightDrivingShare,
      historyLevel,
      burnInRouteCount,
      historySpanDays: burnInRouteCount,
      summary: summarizeStressBucket(driverRoutes),
      seedProfile: cloneProfile(seedProfile),
    });
  }

  const noFuelRoutes = routeResults.filter(route => !route.expectsTrigger);
  const hiddenIntentRoutes = routeResults.filter(route => route.expectsTrigger);
  const truePositives = hiddenIntentRoutes.filter(route => route.firstTriggerCorrect).length;
  const falsePositives = noFuelRoutes.filter(route => route.triggered).length;
  const wrongStationTriggers = hiddenIntentRoutes.filter(route => route.triggered && !route.firstTriggerCorrect).length;
  const correctCount = routeResults.filter(route => route.correct).length;
  const triggerDistances = hiddenIntentRoutes
    .filter(route => route.firstTriggerCorrect && route.triggerDistance != null)
    .map(route => route.triggerDistance);
  const scenarioBuckets = {};
  for (const route of routeResults) {
    if (!scenarioBuckets[route.scenario]) scenarioBuckets[route.scenario] = [];
    scenarioBuckets[route.scenario].push(route);
  }
  const scenarioBreakdown = Object.fromEntries(
    Object.entries(scenarioBuckets).map(([scenario, routesForScenario]) => [
      scenario,
      summarizeStressBucket(routesForScenario),
    ])
  );
  const historyBuckets = {
    none: null,
    light: null,
    rich: null,
  };
  for (const bucketLabel of Object.keys(historyBuckets)) {
    const bucketRoutes = routeResults.filter(route => route.historyLevelAtStart === bucketLabel);
    if (!bucketRoutes.length) continue;
    const bucketNoFuel = bucketRoutes.filter(route => !route.expectsTrigger);
    const bucketHidden = bucketRoutes.filter(route => route.expectsTrigger);
    historyBuckets[bucketLabel] = buildUnifiedScorecard({
      totalCount: bucketRoutes.length,
      correctCount: bucketRoutes.filter(route => route.correct).length,
      tp: bucketHidden.filter(route => route.firstTriggerCorrect).length,
      fp: bucketNoFuel.filter(route => route.triggered).length,
      fn: bucketHidden.filter(route => !route.firstTriggerCorrect).length,
      tn: bucketNoFuel.filter(route => !route.triggered).length,
      wrongStationTriggers: bucketHidden.filter(route => route.triggered && !route.firstTriggerCorrect).length,
      triggerDistances: bucketHidden
        .filter(route => route.firstTriggerCorrect && route.triggerDistance != null)
        .map(route => route.triggerDistance),
      historyBuckets: null,
    });
  }
  const scorecard = buildUnifiedScorecard({
    totalCount: routeResults.length,
    correctCount,
    tp: truePositives,
    fp: falsePositives,
    fn: hiddenIntentRoutes.length - truePositives,
    tn: noFuelRoutes.length - falsePositives,
    wrongStationTriggers,
    triggerDistances,
    historyBuckets,
  });

  const diagnostics = {
    purposeDistribution,
    trafficDistribution,
    weatherDistribution,
    occupancyDistribution,
    archetypeDistribution,
    avgVisibleStationCount: routeResults.length
      ? Math.round((routeResults.reduce((sum, route) => sum + (route.context?.visibleStationCount || 0), 0) / routeResults.length) * 100) / 100
      : 0,
    visibleTargetCoverageRate: hiddenIntentRoutes.length
      ? Math.round((hiddenIntentRoutes.filter(route => (route.context?.visibleStationIds || []).includes(route.targetStationId)).length / hiddenIntentRoutes.length) * 100)
      : 0,
  };

  return {
    historyLevel,
    driverCount,
    routesPerDriver,
    burnInRouteCountByLevel: { ...REALISTIC_HISTORY_BURN_IN_ROUTES },
    evaluationRouteIndexOffset: REALISTIC_EVALUATION_ROUTE_INDEX_OFFSET,
    households,
    persons,
    vehicles,
    decision_events,
    candidate_stations,
    transactions,
    daily_vehicle_summary,
    drivers,
    routes: routeResults,
    summary: {
      accuracy: scorecard.accuracy,
      hiddenIntentRecall: scorecard.recall,
      precision: scorecard.precision,
      recall: scorecard.recall,
      silentRateWhenNoFuel: scorecard.silentRateWhenNoFuel,
      falsePositiveRate: scorecard.falsePositiveRate,
      wrongStationRate: scorecard.wrongStationRate,
      hiddenIntentCount: scorecard.hiddenIntentCount,
      noFuelCount: scorecard.noFuelCount,
      avgCorrectTriggerDistanceMeters: scorecard.avgCorrectTriggerDistanceMeters,
      precisionFirstScore: scorecard.precisionFirstScore,
      scorecard,
      historyBuckets,
      scenarioBreakdown,
      diagnostics,
    },
  };
}

function summarizeStressBucket(routeResults) {
  if (!routeResults.length) {
    return null;
  }
  const correct = routeResults.filter(route => route.correct).length;
  const expectedTriggers = routeResults.filter(route => route.expectsTrigger);
  const noFuelRoutes = routeResults.filter(route => !route.expectsTrigger);
  const truePositives = expectedTriggers.filter(route => route.firstTriggerCorrect).length;
  const falsePositives = noFuelRoutes.filter(route => route.triggered).length;
  const wrongStationTriggers = expectedTriggers.filter(route => route.triggered && !route.firstTriggerCorrect).length;
  const triggerDistances = expectedTriggers
    .filter(route => route.firstTriggerCorrect && route.triggerDistance != null)
    .map(route => route.triggerDistance);

  return {
    count: routeResults.length,
    accuracy: Math.round((correct / routeResults.length) * 100),
    hiddenIntentRecall: expectedTriggers.length
      ? Math.round((truePositives / expectedTriggers.length) * 100)
      : null,
    silentRateWhenNoFuel: noFuelRoutes.length
      ? Math.round(((noFuelRoutes.length - falsePositives) / noFuelRoutes.length) * 100)
      : null,
    wrongStationRate: expectedTriggers.length
      ? Math.round((wrongStationTriggers / expectedTriggers.length) * 100)
      : null,
    avgCorrectTriggerDistanceMeters: triggerDistances.length
      ? Math.round(triggerDistances.reduce((a, b) => a + b, 0) / triggerDistances.length)
      : null,
  };
}

function buildUnifiedScorecard({
  totalCount,
  correctCount,
  tp,
  fp,
  fn,
  tn,
  wrongStationTriggers = 0,
  triggerDistances = [],
  historyBuckets = null,
}) {
  const accuracy = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
  const precision = (tp + fp) > 0 ? Math.round((tp / (tp + fp)) * 100) : 0;
  const recall = (tp + fn) > 0 ? Math.round((tp / (tp + fn)) * 100) : 0;
  const falsePositiveRate = (fp + tn) > 0 ? Math.round((fp / (fp + tn)) * 100) : 0;
  const silentRateWhenNoFuel = (fp + tn) > 0 ? Math.round((tn / (fp + tn)) * 100) : null;
  const wrongStationRate = (tp + fn) > 0 ? Math.round((wrongStationTriggers / (tp + fn)) * 100) : null;
  const avgCorrectTriggerDistanceMeters = triggerDistances.length
    ? Math.round(triggerDistances.reduce((a, b) => a + b, 0) / triggerDistances.length)
    : null;
  const precisionFirstScore = totalCount > 0
    ? Math.round((((tp * 1) + (tn * 1) - (fp * 2) - (fn * 1)) / totalCount) * 100)
    : 0;

  return {
    accuracy,
    precision,
    recall,
    falsePositiveRate,
    silentRateWhenNoFuel,
    wrongStationRate,
    avgCorrectTriggerDistanceMeters,
    precisionFirstScore,
    hiddenIntentCount: tp + fn,
    noFuelCount: fp + tn,
    historyBuckets,
  };
}

// Helper: build a morning commute route from home to work, passing by the
// driver's usual Shell. If `withStop` is true, the driver actually stops at
// Shell at the end; otherwise they continue past it.
function commuterMorning(stationId, withStop) {
  // Home at (39.7385, -105.0600), work at (39.7385, -104.9400), Shell at (39.7385, -104.9726)
  const waypoints = interpolate(
    { lat: 39.7385, lon: -105.0600 },
    { lat: 39.7385, lon: -104.9400 },
    12,
    (t) => (t > 0.7 && withStop ? Math.max(10, 30 - (t - 0.7) * 60) : 28),
  );
  // If withStop, the last waypoint snaps to the actual Shell location.
  if (withStop) {
    waypoints[waypoints.length - 2] = { lat: 39.7385, lon: -104.9726, speedMph: 10 };
    waypoints[waypoints.length - 1] = { lat: 39.7385, lon: -104.9720, speedMph: 6 };
  }
  return {
    id: `commuter-morning-${withStop ? 'stop' : 'drive'}`,
    destinationStationId: withStop ? stationId : null,
    recommendationStationId: 'sim-king-soopers-east',
    expectsTrigger: true, // always expect a predictive trigger (even for non-stops, we want to surface the cheaper alternative)
    waypoints,
    overrideTime: { hour: 7, dayOfWeek: 2 },
    scenario: 'city',
  };
}

// Helper: build an evening commute (reverse direction) passing by Shell
function commuterEvening(stationId) {
  const waypoints = interpolate(
    { lat: 39.7385, lon: -104.9400 },
    { lat: 39.7385, lon: -105.0600 },
    12,
    () => 28,
  );
  return {
    id: 'commuter-evening',
    destinationStationId: null,
    expectsTrigger: false,
    waypoints,
    overrideTime: { hour: 18, dayOfWeek: 2 },
    scenario: 'city',
  };
}

// Helper: weekend Costco bulk trip route
function weekendCostcoTrip() {
  const waypoints = interpolate(
    { lat: 39.7000, lon: -104.9800 },
    { lat: 39.6128, lon: -104.9872 },
    14,
    (t) => Math.max(10, 30 - t * 15),
  );
  return {
    id: 'weekend-costco',
    destinationStationId: 'sim-costco-s',
    recommendationStationId: 'sim-costco-s',
    expectsTrigger: true,
    waypoints,
    overrideTime: { hour: 10, dayOfWeek: 6 },
    scenario: 'city',
  };
}

// Helper: I-70 road trip (3+ hour highway drive)
// The driver starts in Denver and heads east toward Kansas. Over the course
// of the drive they pass multiple I-70 highway stations. Tank starts fairly
// full but gradually runs low — the engine should fire at the RIGHT station
// as urgency increases.
function longRoadTrip(distanceKm = 200) {
  // Start at Denver, heading east on I-70.
  const start = { lat: 39.7468, lon: -104.9900 };
  const end = { lat: 39.7500, lon: -103.6500 }; // ~200 km east
  const waypoints = interpolate(start, end, 40, () => 68); // 68 mph highway
  return {
    id: `roadtrip-${distanceKm}km`,
    destinationStationId: 'sim-loves-i70-b', // the "best" price station on path
    recommendationStationId: 'sim-loves-i70-b',
    expectsTrigger: true,
    waypoints,
    scenario: 'highway',
  };
}

// Helper: empty urban drive (no shopping, no commute) — should NOT trigger.
function leisureDrive() {
  const waypoints = interpolate(
    { lat: 39.7200, lon: -104.9800 },
    { lat: 39.7200, lon: -104.9200 },
    10,
    () => 22,
  );
  return {
    id: 'leisure-drive',
    destinationStationId: null,
    recommendationStationId: null,
    expectsTrigger: false,
    waypoints,
    overrideTime: { hour: 14, dayOfWeek: 3 },
    scenario: 'city',
  };
}

// Helper: pre-stop trajectory — driver 4km out from their usual Shell,
// heading straight for it. This is the early-warning scenario.
function earlyWarningCommute() {
  const waypoints = interpolate(
    { lat: 39.7385, lon: -105.0200 },
    { lat: 39.7385, lon: -104.9726 },
    10,
    (t) => Math.max(18, 30 - t * 6),
  );
  return {
    id: 'early-warning-commute',
    destinationStationId: 'sim-shell-downing',
    recommendationStationId: 'sim-king-soopers-east',
    expectsTrigger: true,
    waypoints,
    overrideTime: { hour: 7, dayOfWeek: 3 },
    scenario: 'city',
  };
}

function classifyHistoryLevel(totalVisitCount) {
  if (totalVisitCount <= 0) return 'none';
  if (totalVisitCount <= 5) return 'light';
  return 'rich';
}

function classifyShortHorizonHistoryLevel(totalVisitCount) {
  if (totalVisitCount <= 0) return 'none';
  if (totalVisitCount <= 2) return 'light';
  return 'rich';
}

/**
 * Build a 21-day schedule for a fueler archetype. Each day returns:
 *   { day, dayOfWeek, hour, route, tankState, expectsAction, reasoning }
 *
 * The scheduler decides when the user actually fills up (based on tank state)
 * — driving simulates the natural day-to-day usage pattern.
 */
function buildCommuterSchedule() {
  const schedule = [];
  for (let day = 0; day < 21; day++) {
    const dow = (day + 1) % 7; // start on a Tuesday
    const isWeekend = dow === 0 || dow === 6;
    if (isWeekend) {
      // Weekend: maybe a leisure drive
      schedule.push({
        day,
        dayOfWeek: dow,
        hour: 14,
        route: { ...leisureDrive(), overrideTime: { hour: 14, dayOfWeek: dow } },
        scenario: 'weekend',
        // On ~ every 7th day the commuter fills up at Shell at the weekend too
        willStop: day === 6 || day === 13,
      });
    } else {
      // Weekday morning commute
      // They stop at Shell every 3-4 days when tank is low enough
      const willStop = day % 4 === 3;
      schedule.push({
        day,
        dayOfWeek: dow,
        hour: 7,
        route: commuterMorning('sim-shell-downing', willStop),
        scenario: 'weekday-morning',
        willStop,
      });
    }
  }
  return schedule;
}

function buildRoadTripperSchedule() {
  const schedule = [];
  for (let day = 0; day < 21; day++) {
    const dow = (day + 1) % 7;
    // Road trippers hit the road every 2-3 days
    if (day % 3 === 2) {
      schedule.push({
        day,
        dayOfWeek: dow,
        hour: 10,
        route: longRoadTrip(200),
        scenario: 'roadtrip',
        willStop: true,
      });
    } else {
      // Leisure in town
      schedule.push({
        day,
        dayOfWeek: dow,
        hour: 14,
        route: { ...leisureDrive(), overrideTime: { hour: 14, dayOfWeek: dow } },
        scenario: 'city',
        willStop: false,
      });
    }
  }
  return schedule;
}

function buildWeekendShopperSchedule() {
  const schedule = [];
  for (let day = 0; day < 21; day++) {
    const dow = (day + 1) % 7;
    const isSaturday = dow === 6;
    if (isSaturday) {
      schedule.push({
        day,
        dayOfWeek: dow,
        hour: 10,
        route: weekendCostcoTrip(),
        scenario: 'costco-trip',
        willStop: true,
      });
    } else {
      // Weekday leisure drives, no fueling
      schedule.push({
        day,
        dayOfWeek: dow,
        hour: 14,
        route: { ...leisureDrive(), overrideTime: { hour: 14, dayOfWeek: dow } },
        scenario: 'city',
        willStop: false,
      });
    }
  }
  return schedule;
}

function buildRandomDriverSchedule() {
  const schedule = [];
  // No pattern — occasionally stops at various stations
  for (let day = 0; day < 21; day++) {
    const dow = (day + 1) % 7;
    const route = day % 3 === 0
      ? commuterMorning('sim-king-soopers-east', day % 6 === 3)
      : leisureDrive();
    schedule.push({
      day,
      dayOfWeek: dow,
      hour: day % 3 === 0 ? 8 : 14,
      route: { ...route, overrideTime: { hour: day % 3 === 0 ? 8 : 14, dayOfWeek: dow } },
      scenario: day % 3 === 0 ? 'weekday-morning' : 'city',
      willStop: day % 6 === 3,
    });
  }
  return schedule;
}

const SCHEDULES = {
  commuter: buildCommuterSchedule,
  road_tripper: buildRoadTripperSchedule,
  weekend_shopper: buildWeekendShopperSchedule,
  random_driver: buildRandomDriverSchedule,
};

/**
 * Run a 21-day simulation for a given archetype, returning day-by-day results.
 *
 * For each day:
 *   1. Load the planned route
 *   2. Optionally apply GPS + stop-sign/red-light noise
 *   3. Create an engine (or recommender) with the current profile state
 *   4. Feed samples, record triggers and trigger distances
 *   5. If the user "stopped" (willStop=true), update the profile's visit and
 *      fill-up history for the NEXT day (history accumulates over time)
 *
 * Returns: { archetype, days: [{day, triggered, correct, triggerDistance, reasoning}], summary }
 */
function simulate21Days({ archetype, createEngineFn, applyNoise = true, noiseSeed = 42 }) {
  const scheduleBuilder = SCHEDULES[archetype];
  if (!scheduleBuilder) throw new Error('unknown archetype: ' + archetype);
  const schedule = scheduleBuilder();

  const profile = {
    id: archetype,
    visitHistory: [],
    fillUpHistory: [
      {
        timestamp: Date.UTC(2026, 0, 1, 8, 0, 0),
        odometer: 40000,
        gallons: archetype === 'road_tripper' ? 14 : 12,
        pricePerGallon: 3.35,
      },
    ],
    estimatedMilesSinceLastFill: archetype === 'road_tripper' ? 150 : 110,
    odometerMiles: archetype === 'road_tripper' ? 40150 : 40110,
    typicalFillUpIntervalMiles: archetype === 'road_tripper' ? 320 : (archetype === 'commuter' ? 260 : 290),
    preferredBrands: archetype === 'commuter' ? ['Shell'] :
                     archetype === 'weekend_shopper' ? ['Costco'] :
                     archetype === 'road_tripper' ? ['Pilot', "Love's"] : [],
    brandLoyalty: archetype === 'commuter' ? 0.6 :
                  archetype === 'weekend_shopper' ? 0.7 : 0.3,
    distanceWeight: 0.5,
    priceWeight: archetype === 'weekend_shopper' ? 0.8 : 0.4,
  };

  const days = [];
  for (let i = 0; i < schedule.length; i++) {
    const dayPlan = schedule[i];
    const route = dayPlan.route;
    const samples = routeToSamples(route);
    const noisyRun = applyNoise
      ? addDrivingNoise(samples, {
        seed: noiseSeed + i,
        returnMetadata: true,
        stopProbability: dayPlan.scenario === 'roadtrip' ? 0.15 : 0.72,
        stopIntervalM: dayPlan.scenario === 'roadtrip' ? 1800 : 420,
        skipStopsAboveSpeed: dayPlan.scenario === 'roadtrip' ? 24 : 18,
      })
      : { samples, noiseEvents: [] };
    const noisySamples = noisyRun.samples;

    const triggers = [];
    profile.estimatedMilesSinceLastFill = Number(profile.estimatedMilesSinceLastFill) || 0;
    const engine = createEngineFn({
      profile,
      onTrigger: (e) => triggers.push(e),
    });

    const extraContext = dayPlan.scenario === 'roadtrip'
      ? { isRoadTripHint: true, urgency: 0.92 }
      : {};

    for (const s of noisySamples) {
      engine.pushLocation(s, extraContext);
    }

    const historyVisitCount = profile.visitHistory.reduce((a, h) => a + h.visitCount, 0);
    const targetStationId = route.recommendationStationId || route.destinationStationId || null;
    const matchedTrigger = targetStationId
      ? triggers.find(trigger => trigger.stationId === targetStationId)
      : null;
    const firstTrigger = triggers[0] || null;

    // Determine correctness: did we correctly surface a trigger for this
    // day's trajectory? "Correct" means:
    //  - expectsTrigger && the correct recommendation station fired
    //  - !expectsTrigger && no trigger fired
    // For early-warning we also track trigger distance (farther = better).
    const triggered = triggers.length > 0;
    const triggerDistance = matchedTrigger && matchedTrigger.triggerDistance != null
      ? matchedTrigger.triggerDistance
      : (matchedTrigger ? matchedTrigger.forwardDistance : (firstTrigger ? (firstTrigger.triggerDistance ?? firstTrigger.forwardDistance ?? null) : null));

    const expectsTrigger = route.expectsTrigger;
    const correctStationTriggered = Boolean(matchedTrigger);
    const firstTriggerCorrect = Boolean(firstTrigger && targetStationId && firstTrigger.stationId === targetStationId);
    const wrongStationTriggered = triggered && !firstTriggerCorrect;
    const correct = expectsTrigger ? firstTriggerCorrect : !triggered;
    const historyLevel = classifyShortHorizonHistoryLevel(historyVisitCount);
    const stopSignCount = noisyRun.noiseEvents.filter(event => event.type === 'stop_sign').length;
    const trafficLightCount = noisyRun.noiseEvents.filter(event => event.type === 'traffic_light').length;

    days.push({
      day: dayPlan.day,
      dayOfWeek: dayPlan.dayOfWeek,
      scenario: dayPlan.scenario,
      willStop: dayPlan.willStop,
      targetStationId,
      expectsTrigger,
      triggered,
      correctStationTriggered,
      firstTriggerCorrect,
      wrongStationTriggered,
      triggerDistance,
      triggerReason: firstTrigger?.reason || null,
      triggeredStationId: firstTrigger?.stationId || null,
      correct,
      historyCount: historyVisitCount,
      historyLevel,
      visitCount: historyVisitCount,
      startingMilesSinceLastFill: Math.round(profile.estimatedMilesSinceLastFill || 0),
      stopSignCount,
      trafficLightCount,
    });

    // Update history if the user actually stopped today
    const routeDistanceMiles = routeDistanceMilesFromWaypoints(route.waypoints);
    profile.odometerMiles = (Number(profile.odometerMiles) || 40000) + routeDistanceMiles;
    if (dayPlan.willStop && route.destinationStationId) {
      const stationId = route.destinationStationId;
      const nowMs = samples[samples.length - 1].timestamp;
      recordProfileVisit(profile, stationId, nowMs, {
        scenario: route?.scenario,
        hour: route?.hour,
        dayOfWeek: route?.dayOfWeek,
      });
      profile.fillUpHistory.push({
        timestamp: nowMs,
        odometer: profile.odometerMiles,
        gallons: 12,
        pricePerGallon: 3.3,
      });
      profile.estimatedMilesSinceLastFill = 0;
    } else {
      profile.estimatedMilesSinceLastFill += routeDistanceMiles;
    }
  }

  const correctCount = days.filter(d => d.correct).length;
  const tp = days.filter(d => d.expectsTrigger && d.firstTriggerCorrect).length;
  const fp = days.filter(d => !d.expectsTrigger && d.triggered).length;
  const fn = days.filter(d => d.expectsTrigger && !d.firstTriggerCorrect).length;
  const tn = days.filter(d => !d.expectsTrigger && !d.triggered).length;
  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
  const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
  const falsePositiveRate = (fp + tn) > 0 ? fp / (fp + tn) : 0;
  const precisionFirstScore = ((tp * 1) + (tn * 1) - (fp * 2) - (fn * 1)) / days.length;
  const triggerDistances = days
    .filter(d => d.correctStationTriggered && d.triggerDistance != null)
    .map(d => d.triggerDistance);
  const avgDist = triggerDistances.length
    ? triggerDistances.reduce((a, b) => a + b, 0) / triggerDistances.length
    : 0;

  // History-level buckets
  const noHistoryDays = days.filter(d => d.historyLevel === 'none');
  const someHistoryDays = days.filter(d => d.historyLevel === 'light');
  const richHistoryDays = days.filter(d => d.historyLevel === 'rich');

  function summarizeBucket(bucketDays) {
    if (!bucketDays.length) return null;
    const tpDays = bucketDays.filter(d => d.correctStationTriggered && d.triggerDistance != null);
    const bucketDistances = tpDays.map(d => d.triggerDistance);
    const triggerRate = bucketDays.filter(d => d.triggered).length / bucketDays.length;
    return {
      count: bucketDays.length,
      accuracy: Math.round((bucketDays.filter(d => d.correct).length / bucketDays.length) * 100),
      triggerRate: Math.round(triggerRate * 100),
      avgCorrectTriggerDistanceMeters: bucketDistances.length
        ? Math.round(bucketDistances.reduce((a, b) => a + b, 0) / bucketDistances.length)
        : null,
    };
  }

  const scorecard = buildUnifiedScorecard({
    totalCount: days.length,
    correctCount,
    tp,
    fp,
    fn,
    tn,
    wrongStationTriggers: days.filter(d => d.wrongStationTriggered).length,
    triggerDistances,
    historyBuckets: {
      none: summarizeBucket(noHistoryDays),
      light: summarizeBucket(someHistoryDays),
      rich: summarizeBucket(richHistoryDays),
    },
  });

  return {
    archetype,
    days,
    summary: {
      accuracy: scorecard.accuracy,
      correct: correctCount,
      total: days.length,
      tp,
      fp,
      fn,
      tn,
      precision: scorecard.precision,
      recall: scorecard.recall,
      falsePositiveRate: scorecard.falsePositiveRate,
      silentRateWhenNoFuel: scorecard.silentRateWhenNoFuel,
      wrongStationRate: scorecard.wrongStationRate,
      precisionFirstScore: scorecard.precisionFirstScore,
      avgTriggerDistanceMeters: Math.round(avgDist),
      avgCorrectTriggerDistanceMeters: scorecard.avgCorrectTriggerDistanceMeters,
      noHistoryAcc: noHistoryDays.length > 0
        ? Math.round((noHistoryDays.filter(d => d.correct).length / noHistoryDays.length) * 100)
        : null,
      someHistoryAcc: someHistoryDays.length > 0
        ? Math.round((someHistoryDays.filter(d => d.correct).length / someHistoryDays.length) * 100)
        : null,
      richHistoryAcc: richHistoryDays.length > 0
        ? Math.round((richHistoryDays.filter(d => d.correct).length / richHistoryDays.length) * 100)
        : null,
      historyBuckets: scorecard.historyBuckets,
      scorecard,
    },
  };
}

function simulateHiddenIntentStressBatch({
  createEngineFn,
  applyNoise = true,
  noiseSeed = 2026,
  routeCount = 72,
  historyLevel = 'none',
  freezeVisitHistory = true,
  latentPlanHistoryLevel = 'none',
  collectRouteEvents = false,
} = {}) {
  if (typeof createEngineFn !== 'function') {
    throw new Error('simulateHiddenIntentStressBatch requires a createEngineFn');
  }

  const routes = buildAdaptiveHiddenIntentStressRoutes({
    seed: noiseSeed,
    routeCount,
    historyLevel: latentPlanHistoryLevel,
  });
  const profile = cloneProfile(buildStressProfile(historyLevel));
  const routeResults = [];

  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    profile.estimatedMilesSinceLastFill = Number(route.startingMilesSinceLastFill) || 0;
    const historyVisitCount = profile.visitHistory.reduce((sum, entry) => sum + (Number(entry?.visitCount) || 0), 0);
    const triggers = [];
    const engine = createEngineFn({
      profile,
      onTrigger: event => triggers.push(event),
    });
    const samples = routeToSamples(route);
    const noisyRun = applyNoise
      ? addDrivingNoise(samples, {
        seed: noiseSeed + index,
        returnMetadata: true,
        stopProbability: route.scenario === 'highway' ? 0.12 : (route.scenario === 'city_grid' ? 0.82 : 0.62),
        stopIntervalM: route.scenario === 'highway' ? 1800 : (route.scenario === 'city_grid' ? 260 : 420),
        skipStopsAboveSpeed: route.scenario === 'highway' ? 24 : 18,
      })
      : { samples, noiseEvents: [] };

    for (const sample of noisyRun.samples) {
      engine.pushLocation(sample);
    }

    const firstTrigger = triggers[0] || null;
    const matchedTrigger = route.targetStationId
      ? triggers.find(trigger => trigger.stationId === route.targetStationId)
      : null;
    const triggered = triggers.length > 0;
    const firstTriggerCorrect = Boolean(firstTrigger && route.targetStationId && firstTrigger.stationId === route.targetStationId);
    const triggerDistance = matchedTrigger?.triggerDistance ??
      matchedTrigger?.forwardDistance ??
      firstTrigger?.triggerDistance ??
      firstTrigger?.forwardDistance ??
      null;
    const correct = route.expectsTrigger ? firstTriggerCorrect : !triggered;

    routeResults.push({
      routeId: route.id,
      scenario: route.scenario,
      intentClass: route.intentClass || (route.fuelStateBefore?.estimatedRemainingMiles <= 110 ? 'probable' : 'impulsive'),
      expectsTrigger: route.expectsTrigger,
      triggered,
      firstTriggerCorrect,
      triggerDistance,
      triggeredStationId: firstTrigger?.stationId || null,
      targetStationId: route.targetStationId,
      hiddenDecisionIndex: route.hiddenDecisionIndex,
      startingMilesSinceLastFill: route.startingMilesSinceLastFill,
      estimatedRemainingMiles: route.fuelStateBefore?.estimatedRemainingMiles ?? null,
      historyCount: historyVisitCount,
      historyLevelAtStart: classifyHistoryLevel(historyVisitCount),
      correct,
      stopSignCount: noisyRun.noiseEvents.filter(event => event.type === 'stop_sign').length,
      trafficLightCount: noisyRun.noiseEvents.filter(event => event.type === 'traffic_light').length,
      ...(collectRouteEvents
        ? {
          routeEvents: triggers.map(event => ({ ...event })),
        }
        : {}),
    });

    const routeDistanceMiles = routeDistanceMilesFromWaypoints(route.waypoints);
    profile.odometerMiles = (Number(profile.odometerMiles) || 40000) + routeDistanceMiles;
    if (route.expectsTrigger && route.targetStationId) {
      const fillTimestamp = Date.UTC(2026, 0, 1, 8, 0, 0) + (index * 60_000);
      profile.fillUpHistory.push({
        timestamp: fillTimestamp,
        odometer: profile.odometerMiles,
        gallons: 12,
        pricePerGallon: findStationById(route.targetStationId)?.price || 3.35,
      });
      if (!freezeVisitHistory) {
        recordProfileVisit(profile, route.targetStationId, fillTimestamp, {
          scenario: route?.scenario,
          hour: route?.context?.hour,
          dayOfWeek: route?.context?.dayOfWeek,
        });
      }
      profile.estimatedMilesSinceLastFill = 0;
    } else {
      profile.estimatedMilesSinceLastFill += routeDistanceMiles;
    }
  }

  const noFuelRoutes = routeResults.filter(route => !route.expectsTrigger);
  const hiddenIntentRoutes = routeResults.filter(route => route.expectsTrigger);
  const truePositives = hiddenIntentRoutes.filter(route => route.firstTriggerCorrect).length;
  const falsePositives = noFuelRoutes.filter(route => route.triggered).length;
  const wrongStationTriggers = hiddenIntentRoutes.filter(route => route.triggered && !route.firstTriggerCorrect).length;
  const correctCount = routeResults.filter(route => route.correct).length;
  const triggerDistances = hiddenIntentRoutes
    .filter(route => route.firstTriggerCorrect && route.triggerDistance != null)
    .map(route => route.triggerDistance);

  const scenarioBuckets = {};
  for (const route of routeResults) {
    if (!scenarioBuckets[route.scenario]) {
      scenarioBuckets[route.scenario] = [];
    }
    scenarioBuckets[route.scenario].push(route);
  }
  const scenarioBreakdown = Object.fromEntries(
    Object.entries(scenarioBuckets).map(([scenario, routesForScenario]) => [
      scenario,
      summarizeStressBucket(routesForScenario),
    ])
  );
  const intentClassBuckets = {
    probable: routeResults.filter(route => route.expectsTrigger && route.intentClass === 'probable'),
    impulsive: routeResults.filter(route => route.expectsTrigger && route.intentClass === 'impulsive'),
  };
  const intentClassBreakdown = Object.fromEntries(
    Object.entries(intentClassBuckets).map(([label, bucketRoutes]) => {
      const correctBucket = bucketRoutes.filter(route => route.firstTriggerCorrect).length;
      return [
        label,
        {
          count: bucketRoutes.length,
          recall: bucketRoutes.length
            ? Math.round((correctBucket / bucketRoutes.length) * 100)
            : null,
        },
      ];
    })
  );
  const historyBucketResults = {
    none: routeResults.filter(route => route.historyLevelAtStart === 'none'),
    light: routeResults.filter(route => route.historyLevelAtStart === 'light'),
    rich: routeResults.filter(route => route.historyLevelAtStart === 'rich'),
  };
  const historyBuckets = Object.fromEntries(
    Object.entries(historyBucketResults).map(([label, bucketRoutes]) => {
      const bucketNoFuel = bucketRoutes.filter(route => !route.expectsTrigger);
      const bucketHidden = bucketRoutes.filter(route => route.expectsTrigger);
      const bucketTp = bucketHidden.filter(route => route.firstTriggerCorrect).length;
      const bucketFp = bucketNoFuel.filter(route => route.triggered).length;
      const bucketFn = bucketHidden.length - bucketTp;
      const bucketTn = bucketNoFuel.length - bucketFp;
      const bucketWrong = bucketHidden.filter(route => route.triggered && !route.firstTriggerCorrect).length;
      const bucketTriggerDistances = bucketHidden
        .filter(route => route.firstTriggerCorrect && route.triggerDistance != null)
        .map(route => route.triggerDistance);
      return [
        label,
        bucketRoutes.length
          ? buildUnifiedScorecard({
            totalCount: bucketRoutes.length,
            correctCount: bucketRoutes.filter(route => route.correct).length,
            tp: bucketTp,
            fp: bucketFp,
            fn: bucketFn,
            tn: bucketTn,
            wrongStationTriggers: bucketWrong,
            triggerDistances: bucketTriggerDistances,
            historyBuckets: null,
          })
          : null,
      ];
    })
  );

  const scorecard = buildUnifiedScorecard({
    totalCount: routeResults.length,
    correctCount,
    tp: truePositives,
    fp: falsePositives,
    fn: hiddenIntentRoutes.length - truePositives,
    tn: noFuelRoutes.length - falsePositives,
    wrongStationTriggers,
    triggerDistances,
    historyBuckets,
  });

  return {
    historyLevel,
    routeCount,
    routes: routeResults,
    summary: {
      accuracy: scorecard.accuracy,
      hiddenIntentRecall: scorecard.recall,
      precision: scorecard.precision,
      recall: scorecard.recall,
      silentRateWhenNoFuel: scorecard.silentRateWhenNoFuel,
      falsePositiveRate: scorecard.falsePositiveRate,
      wrongStationRate: scorecard.wrongStationRate,
      hiddenIntentCount: scorecard.hiddenIntentCount,
      noFuelCount: scorecard.noFuelCount,
      avgCorrectTriggerDistanceMeters: scorecard.avgCorrectTriggerDistanceMeters,
      precisionFirstScore: scorecard.precisionFirstScore,
      scorecard,
      historyBuckets,
      scenarioBreakdown,
      intentClassBreakdown,
      probableHiddenIntentRecall: intentClassBreakdown.probable?.recall ?? null,
      impulsiveHiddenIntentRecall: intentClassBreakdown.impulsive?.recall ?? null,
    },
  };
}

module.exports = {
  simulate21Days,
  simulateHiddenIntentStressBatch,
  simulateRealisticHiddenIntentBatch,
  simulateRealisticCohortBatch,
  buildHiddenIntentStressRoutes,
  buildAdaptiveHiddenIntentStressRoutes,
  buildStressProfile,
  buildRealisticDriverSpec,
  buildRealisticStressProfile,
  SCHEDULES,
  SIM_STATIONS,
  commuterMorning,
  commuterEvening,
  weekendCostcoTrip,
  longRoadTrip,
  leisureDrive,
  earlyWarningCommute,
  buildCommuterSchedule,
  buildRoadTripperSchedule,
  buildWeekendShopperSchedule,
  buildRandomDriverSchedule,
};
