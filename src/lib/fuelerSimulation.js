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
  return SIM_STATIONS.find(station => station.stationId === stationId) || null;
}

function choose(rand, items) {
  return items[Math.floor(rand() * items.length)];
}

function randomInt(rand, min, maxInclusive) {
  return min + Math.floor(rand() * ((maxInclusive - min) + 1));
}

const HIDDEN_INTENT_BLUEPRINTS = [
  {
    id: 'city-cross-town',
    scenario: 'city',
    defaultHour: 8,
    dayOfWeek: 2,
    hiddenFuelProbability: 0.28,
    candidateStationIds: ['sim-king-soopers-east', 'sim-shell-downing', 'sim-chevron-speer'],
    controlPoints: [
      { lat: 39.7385, lon: -105.0700 },
      { lat: 39.7390, lon: -105.0300 },
      { lat: 39.7392, lon: -104.9950 },
      { lat: 39.7400, lon: -104.9450 },
    ],
    speedFns: [() => 27, () => 23, () => 26],
  },
  {
    id: 'south-errand-arc',
    scenario: 'city',
    defaultHour: 13,
    dayOfWeek: 4,
    hiddenFuelProbability: 0.24,
    candidateStationIds: ['sim-costco-s', 'sim-shell-broadway', 'sim-maverik-alameda'],
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
    scenario: 'suburban',
    defaultHour: 11,
    dayOfWeek: 6,
    hiddenFuelProbability: 0.22,
    candidateStationIds: ['sim-costco-n', 'sim-sams-club'],
    controlPoints: [
      { lat: 39.8000, lon: -105.0700 },
      { lat: 39.8200, lon: -105.0400 },
      { lat: 39.8400, lon: -105.0100 },
      { lat: 39.8550, lon: -104.9550 },
    ],
    speedFns: [() => 32, () => 30, () => 34],
  },
  {
    id: 'airport-corridor',
    scenario: 'highway',
    defaultHour: 10,
    dayOfWeek: 3,
    hiddenFuelProbability: 0.42,
    candidateStationIds: ['sim-pilot-i70-a', 'sim-loves-i70-b', 'sim-ta-i70-c'],
    controlPoints: [
      { lat: 39.7440, lon: -105.0050 },
      { lat: 39.7460, lon: -104.9300 },
      { lat: 39.7470, lon: -104.8200 },
      { lat: 39.7480, lon: -104.6900 },
    ],
    speedFns: [() => 58, () => 64, () => 67],
  },
  {
    id: 'downtown-grid',
    scenario: 'city_grid',
    defaultHour: 17,
    dayOfWeek: 2,
    hiddenFuelProbability: 0.18,
    candidateStationIds: ['sim-chevron-speer', 'sim-shell-downing', 'sim-maverik-alameda'],
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
}) {
  const baseWaypoints = stitchInterpolatedPoints(blueprint.controlPoints, 5, blueprint.speedFns);
  const willStop = rand() < blueprint.hiddenFuelProbability;
  const hiddenDecisionIndex = willStop
    ? randomInt(rand, Math.max(4, Math.floor(baseWaypoints.length * 0.35)), Math.max(5, Math.floor(baseWaypoints.length * 0.72)))
    : null;
  let waypoints = baseWaypoints;
  let destinationStationId = null;
  let recommendationStationId = null;
  let targetStation = null;

  if (willStop) {
    destinationStationId = choose(rand, blueprint.candidateStationIds);
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
  if (historyLevel === 'rich') {
    const now = Date.now();
    return {
      preferredBrands: ['Shell'],
      brandLoyalty: 0.65,
      visitHistory: [
        { stationId: 'sim-shell-downing', visitCount: 6, lastVisitMs: now - 86_400_000, visitTimestamps: [now - 86_400_000, now - 2 * 86_400_000] },
        { stationId: 'sim-shell-broadway', visitCount: 4, lastVisitMs: now - 3 * 86_400_000, visitTimestamps: [now - 3 * 86_400_000] },
      ],
      fillUpHistory: [
        { timestamp: now - 5 * 86_400_000, odometer: 41000, gallons: 11.5, pricePerGallon: 3.42 },
        { timestamp: now - 10 * 86_400_000, odometer: 40710, gallons: 11.8, pricePerGallon: 3.38 },
      ],
    };
  }
  if (historyLevel === 'light') {
    const now = Date.now();
    return {
      preferredBrands: ['Shell'],
      brandLoyalty: 0.45,
      visitHistory: [
        { stationId: 'sim-shell-downing', visitCount: 2, lastVisitMs: now - 86_400_000, visitTimestamps: [now - 86_400_000] },
      ],
      fillUpHistory: [
        { timestamp: now - 7 * 86_400_000, odometer: 41000, gallons: 11.2, pricePerGallon: 3.48 },
      ],
    };
  }
  return {
    preferredBrands: [],
    brandLoyalty: 0.2,
    visitHistory: [],
    fillUpHistory: [],
  };
}

function buildHiddenIntentStressRoutes({ seed = 2026, routeCount = 72 } = {}) {
  const rand = mulberry32(seed);
  const routes = [];
  for (let index = 0; index < routeCount; index += 1) {
    const blueprint = choose(rand, HIDDEN_INTENT_BLUEPRINTS);
    routes.push(buildHiddenIntentRoute({
      blueprint,
      routeIndex: index,
      rand,
    }));
  }
  return routes;
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
    fillUpHistory: [],
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
    const historyLevel = classifyHistoryLevel(historyVisitCount);
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
      stopSignCount,
      trafficLightCount,
    });

    // Update history if the user actually stopped today
    if (dayPlan.willStop && route.destinationStationId) {
      const stationId = route.destinationStationId;
      const existing = profile.visitHistory.find(h => h.stationId === stationId);
      const nowMs = samples[samples.length - 1].timestamp;
      if (existing) {
        existing.visitCount++;
        existing.lastVisitMs = nowMs;
        existing.visitTimestamps = existing.visitTimestamps || [];
        existing.visitTimestamps.push(nowMs);
      } else {
        profile.visitHistory.push({
          stationId,
          visitCount: 1,
          lastVisitMs: nowMs,
          visitTimestamps: [nowMs],
        });
      }
      profile.fillUpHistory.push({
        timestamp: nowMs,
        odometer: 40000 + profile.fillUpHistory.length * 280,
        gallons: 12,
        pricePerGallon: 3.3,
      });
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

  return {
    archetype,
    days,
    summary: {
      accuracy: Math.round((correctCount / days.length) * 100),
      correct: correctCount,
      total: days.length,
      tp,
      fp,
      fn,
      tn,
      precision: Math.round(precision * 100),
      recall: Math.round(recall * 100),
      falsePositiveRate: Math.round(falsePositiveRate * 100),
      precisionFirstScore: Math.round(precisionFirstScore * 100),
      avgTriggerDistanceMeters: Math.round(avgDist),
      avgCorrectTriggerDistanceMeters: Math.round(avgDist),
      noHistoryAcc: noHistoryDays.length > 0
        ? Math.round((noHistoryDays.filter(d => d.correct).length / noHistoryDays.length) * 100)
        : null,
      someHistoryAcc: someHistoryDays.length > 0
        ? Math.round((someHistoryDays.filter(d => d.correct).length / someHistoryDays.length) * 100)
        : null,
      richHistoryAcc: richHistoryDays.length > 0
        ? Math.round((richHistoryDays.filter(d => d.correct).length / richHistoryDays.length) * 100)
        : null,
      historyBuckets: {
        none: summarizeBucket(noHistoryDays),
        light: summarizeBucket(someHistoryDays),
        rich: summarizeBucket(richHistoryDays),
      },
    },
  };
}

function simulateHiddenIntentStressBatch({
  createEngineFn,
  applyNoise = true,
  noiseSeed = 2026,
  routeCount = 72,
  historyLevel = 'none',
} = {}) {
  if (typeof createEngineFn !== 'function') {
    throw new Error('simulateHiddenIntentStressBatch requires a createEngineFn');
  }

  const routes = buildHiddenIntentStressRoutes({
    seed: noiseSeed,
    routeCount,
  });
  const profile = buildStressProfile(historyLevel);
  const routeResults = [];

  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
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
      expectsTrigger: route.expectsTrigger,
      triggered,
      firstTriggerCorrect,
      triggerDistance,
      triggeredStationId: firstTrigger?.stationId || null,
      targetStationId: route.targetStationId,
      hiddenDecisionIndex: route.hiddenDecisionIndex,
      correct,
      stopSignCount: noisyRun.noiseEvents.filter(event => event.type === 'stop_sign').length,
      trafficLightCount: noisyRun.noiseEvents.filter(event => event.type === 'traffic_light').length,
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

  return {
    historyLevel,
    routeCount,
    routes: routeResults,
    summary: {
      accuracy: Math.round((correctCount / routeResults.length) * 100),
      hiddenIntentRecall: hiddenIntentRoutes.length
        ? Math.round((truePositives / hiddenIntentRoutes.length) * 100)
        : null,
      silentRateWhenNoFuel: noFuelRoutes.length
        ? Math.round(((noFuelRoutes.length - falsePositives) / noFuelRoutes.length) * 100)
        : null,
      falsePositiveRate: noFuelRoutes.length
        ? Math.round((falsePositives / noFuelRoutes.length) * 100)
        : null,
      wrongStationRate: hiddenIntentRoutes.length
        ? Math.round((wrongStationTriggers / hiddenIntentRoutes.length) * 100)
        : null,
      hiddenIntentCount: hiddenIntentRoutes.length,
      noFuelCount: noFuelRoutes.length,
      avgCorrectTriggerDistanceMeters: triggerDistances.length
        ? Math.round(triggerDistances.reduce((a, b) => a + b, 0) / triggerDistances.length)
        : null,
      scenarioBreakdown,
    },
  };
}

module.exports = {
  simulate21Days,
  simulateHiddenIntentStressBatch,
  buildHiddenIntentStressRoutes,
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
